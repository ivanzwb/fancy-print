import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { ParentRefreshTokenStoreService } from './refresh-token-store.service';

const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_SEC = 14 * 24 * 3600;

export interface ParentTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class ParentAuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly devPassword: string;

  constructor(
    private readonly refreshStore: ParentRefreshTokenStoreService,
  ) {
    this.accessSecret =
      process.env.PARENT_JWT_ACCESS_SECRET ?? 'dev-parent-access-secret';
    this.refreshSecret =
      process.env.PARENT_JWT_REFRESH_SECRET ?? 'dev-parent-refresh-secret';
    this.devPassword = process.env.PARENT_DEV_PASSWORD ?? 'dev';
  }

  async login(email: string, password: string): Promise<ParentTokenResponse> {
    const em = email?.trim();
    if (!em || password !== this.devPassword) {
      throw new UnauthorizedException({
        code: 'PARENT_AUTH_FAILED',
        message: 'Invalid email or password',
      });
    }
    const sub = `parent:${em}`;
    const household_id =
      process.env.PARENT_DEV_HOUSEHOLD_ID ?? 'household-demo-1';
    return this.issueTokens(sub, em, household_id);
  }

  async refresh(refreshToken: string): Promise<ParentTokenResponse> {
    let payload: jwt.JwtPayload;
    let jti: string;
    let sub: string;
    try {
      payload = jwt.verify(refreshToken, this.refreshSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      jti = String(payload.jti);
      sub = String(payload.sub);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token invalid or expired',
      });
    }
    if (payload.typ !== 'parent_refresh' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Malformed refresh token',
      });
    }
    const row = await this.refreshStore.get(jti);
    if (!row || row.sub !== sub) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token revoked or unknown',
      });
    }
    return this.issueTokens(row.sub, row.email, row.household_id);
  }

  verifyAccess(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'MISSING_BEARER_TOKEN',
        message: 'Authorization: Bearer <access_token> required',
      });
    }
    const token = authorization.slice('Bearer '.length).trim();
    try {
      const payload = jwt.verify(token, this.accessSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      if (payload.typ !== 'parent' || !payload.sub || !payload.email) {
        throw new UnauthorizedException({
          code: 'INVALID_ACCESS_TOKEN',
          message: 'Not a parent access token',
        });
      }
      return {
        sub: payload.sub as string,
        email: payload.email as string,
        household_id: payload.household_id as string,
      };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Access token invalid or expired',
      });
    }
  }

  /**
   * Issue tokens for an OIDC-authenticated user without password validation.
   * Called by OidcService after successful OIDC callback.
   */
  async issueTokensFromOidc(
    sub: string,
    email: string,
    household_id: string,
  ): Promise<ParentTokenResponse> {
    return this.issueTokens(sub, email, household_id);
  }

  private async issueTokens(
    sub: string,
    email: string,
    household_id: string,
  ): Promise<ParentTokenResponse> {
    const access = jwt.sign(
      { typ: 'parent', sub, email, household_id },
      this.accessSecret,
      { expiresIn: ACCESS_TTL_SEC },
    );
    const jti = randomBytes(16).toString('hex');
    const refresh = jwt.sign(
      { typ: 'parent_refresh', sub, jti },
      this.refreshSecret,
      { expiresIn: REFRESH_TTL_SEC },
    );
    await this.refreshStore.set(jti, { sub, email, household_id }, REFRESH_TTL_SEC);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SEC,
    };
  }
}
