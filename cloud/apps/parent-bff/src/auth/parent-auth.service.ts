import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

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
  private readonly refreshIndex = new Map<
    string,
    { sub: string; email: string; household_id: string }
  >();

  constructor() {
    this.accessSecret =
      process.env.PARENT_JWT_ACCESS_SECRET ?? 'dev-parent-access-secret';
    this.refreshSecret =
      process.env.PARENT_JWT_REFRESH_SECRET ?? 'dev-parent-refresh-secret';
    this.devPassword = process.env.PARENT_DEV_PASSWORD ?? 'dev';
  }

  login(email: string, password: string): ParentTokenResponse {
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

  refresh(refreshToken: string): ParentTokenResponse {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, this.refreshSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
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
    const row = this.refreshIndex.get(String(payload.jti));
    if (!row || row.sub !== payload.sub) {
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

  private issueTokens(
    sub: string,
    email: string,
    household_id: string,
  ): ParentTokenResponse {
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
    this.refreshIndex.set(jti, { sub, email, household_id });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SEC,
    };
  }
}
