import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { DeviceRegistryService } from '../devices/device-registry.service';
import { RefreshTokenStoreService } from './refresh-token-store.service';

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
  private readonly mtlsAllow = new Set<string>();

  constructor(
    private readonly registry: DeviceRegistryService,
    private readonly refreshStore: RefreshTokenStoreService,
  ) {
    this.accessSecret =
      process.env.DEVICE_JWT_ACCESS_SECRET ?? 'dev-device-access-secret';
    this.refreshSecret =
      process.env.DEVICE_JWT_REFRESH_SECRET ?? 'dev-device-refresh-secret';

    const mtlsRaw = process.env.MTLS_ALLOWED_DEVICE_IDS_JSON?.trim();
    if (mtlsRaw) {
      try {
        const arr = JSON.parse(mtlsRaw) as unknown[];
        for (const x of arr) {
          if (typeof x === 'string' && x.trim()) this.mtlsAllow.add(x.trim());
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Gateway terminates mTLS and forwards `x-device-id-from-mtls` (see MTLS_HEADER_TRUST). */
  async exchangeFromTrustedGateway(deviceId: string): Promise<DeviceTokenResponse> {
    const id = deviceId.trim();
    if (!id) {
      throw new UnauthorizedException({
        code: 'MISSING_DEVICE_ID',
        message: 'device_id is empty',
      });
    }
    if (!this.isMtlsDeviceAllowed(id)) {
      throw new UnauthorizedException({
        code: 'MTLS_DEVICE_NOT_ALLOWED',
        message:
          'device_id not allowed for mTLS exchange; set MTLS_ALLOWED_DEVICE_IDS_JSON or MTLS_TRUST_REGISTERED_DEVICES=1',
      });
    }
    return this.issueTokens(id);
  }

  private isMtlsDeviceAllowed(deviceId: string): boolean {
    if (this.mtlsAllow.has(deviceId)) return true;
    if (process.env.MTLS_TRUST_REGISTERED_DEVICES === '1') {
      return this.registry.hasDevice(deviceId);
    }
    return false;
  }

  async exchangeDeviceCredentials(
    deviceId: string,
    deviceSecret: string,
  ): Promise<DeviceTokenResponse> {
    if (!this.registry.validate(deviceId, deviceSecret)) {
      throw new UnauthorizedException({
        code: 'DEVICE_AUTH_FAILED',
        message: 'Invalid device_id or device_secret',
      });
    }
    return this.issueTokens(deviceId);
  }

  async refreshAccessToken(refreshToken: string): Promise<DeviceTokenResponse> {
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
    if (payload.typ !== 'device_refresh' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Malformed refresh token',
      });
    }
    const row = await this.refreshStore.get(jti);
    if (!row || row.device_id !== sub) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token revoked or unknown',
      });
    }
    return this.issueTokens(sub);
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

  private async issueTokens(deviceId: string): Promise<DeviceTokenResponse> {
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
    await this.refreshStore.set(
      jti,
      {
        device_id: deviceId,
        exp: Date.now() + REFRESH_TTL_SEC * 1000,
      },
      REFRESH_TTL_SEC,
    );
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SEC,
    };
  }
}
