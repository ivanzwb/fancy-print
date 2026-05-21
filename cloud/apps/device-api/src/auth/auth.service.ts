import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

const ACCESS_TTL_SEC = 900;
const REFRESH_TTL_SEC = 7 * 24 * 3600;

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly credentials = new Map<string, string>();
  private readonly refreshIndex = new Map<
    string,
    { device_id: string; exp: number }
  >();

  constructor() {
    this.accessSecret =
      process.env.DEVICE_JWT_ACCESS_SECRET ?? 'dev-device-access-secret';
    this.refreshSecret =
      process.env.DEVICE_JWT_REFRESH_SECRET ?? 'dev-device-refresh-secret';
    const raw =
      process.env.DEVICE_DEV_CREDENTIALS ??
      '{"fancy-print-dev":"fancy-print-secret"}';
    try {
      const creds = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(creds)) {
        this.credentials.set(k, v);
      }
    } catch {
      this.credentials.set('fancy-print-dev', 'fancy-print-secret');
    }
  }

  exchangeDeviceCredentials(
    deviceId: string,
    deviceSecret: string,
  ): DeviceTokenResponse {
    const expected = this.credentials.get(deviceId);
    if (!expected || expected !== deviceSecret) {
      throw new UnauthorizedException({
        code: 'DEVICE_AUTH_FAILED',
        message: 'Invalid device_id or device_secret',
      });
    }
    return this.issueTokens(deviceId);
  }

  refreshAccessToken(refreshToken: string): DeviceTokenResponse {
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
    if (payload.typ !== 'device_refresh' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Malformed refresh token',
      });
    }
    const row = this.refreshIndex.get(String(payload.jti));
    if (!row || row.device_id !== payload.sub) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token revoked or unknown',
      });
    }
    return this.issueTokens(payload.sub);
  }

  verifyAccessToken(authorization?: string): { device_id: string } {
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
      if (payload.typ !== 'device' || !payload.sub) {
        throw new UnauthorizedException({
          code: 'INVALID_ACCESS_TOKEN',
          message: 'Not a device access token',
        });
      }
      return { device_id: payload.sub as string };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Access token invalid or expired',
      });
    }
  }

  private issueTokens(deviceId: string): DeviceTokenResponse {
    const access = jwt.sign(
      { typ: 'device', sub: deviceId },
      this.accessSecret,
      { expiresIn: ACCESS_TTL_SEC },
    );
    const jti = randomBytes(16).toString('hex');
    const refresh = jwt.sign(
      { typ: 'device_refresh', sub: deviceId, jti },
      this.refreshSecret,
      { expiresIn: REFRESH_TTL_SEC },
    );
    this.refreshIndex.set(jti, {
      device_id: deviceId,
      exp: Date.now() + REFRESH_TTL_SEC * 1000,
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SEC,
    };
  }
}
