import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

jest.mock('../common/trusted-proxy', () => ({
  trustedProxyIp: jest.fn(),
}));

import { trustedProxyIp } from '../common/trusted-proxy';
const mockTrustedProxyIp = trustedProxyIp as jest.Mock;

describe('AuthController', () => {
  let controller: AuthController;
  let auth: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            exchangeFromTrustedGateway: jest.fn(),
            exchangeDeviceCredentials: jest.fn(),
            refreshAccessToken: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
    auth = module.get(AuthService) as jest.Mocked<AuthService>;
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.MTLS_HEADER_TRUST;
  });

  // ---------------------------------------------------------------------------
  // POST /auth/mtls
  // ---------------------------------------------------------------------------
  describe('mtlsExchange', () => {
    const mkReq = (ip: string, hdrs: Record<string, string | undefined>) =>
      ({ ip, headers: hdrs }) as any;

    it('should 404 when MTLS_HEADER_TRUST is not 1', async () => {
      await expect(
        controller.mtlsExchange(mkReq('127.0.0.1', {})),
      ).rejects.toThrow(NotFoundException);
    });

    it('should 403 when client IP is not trusted', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(false);

      await expect(
        controller.mtlsExchange(mkReq('203.0.113.1', {})),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include UNTRUSTED_PROXY code and message in 403 response', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(false);

      try {
        await controller.mtlsExchange(mkReq('1.2.3.4', {}));
      } catch (e: any) {
        expect(e.response.code).toBe('UNTRUSTED_PROXY');
        expect(e.response.message).toMatch(/not trusted/i);
        return;
      }
      throw new Error('Expected ForbiddenException');
    });

    it('should 400 when x-device-id-from-mtls header is missing', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(true);

      await expect(
        controller.mtlsExchange(mkReq('127.0.0.1', {})),
      ).rejects.toThrow(BadRequestException);
    });

    it('should 400 when x-device-id-from-mtls header is empty string', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(true);

      await expect(
        controller.mtlsExchange(
          mkReq('127.0.0.1', { 'x-device-id-from-mtls': '  ' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call exchangeFromTrustedGateway for valid mTLS request', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(true);
      auth.exchangeFromTrustedGateway.mockResolvedValue({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await controller.mtlsExchange(
        mkReq('10.0.0.1', { 'x-device-id-from-mtls': 'device-42' }),
      );

      expect(auth.exchangeFromTrustedGateway).toHaveBeenCalledWith('device-42');
      expect(result.access_token).toBe('at');
    });

    it('should trim the device id from the header', async () => {
      process.env.MTLS_HEADER_TRUST = '1';
      mockTrustedProxyIp.mockReturnValue(true);
      auth.exchangeFromTrustedGateway.mockResolvedValue({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      await controller.mtlsExchange(
        mkReq('127.0.0.1', { 'x-device-id-from-mtls': '  dev-99  ' }),
      );

      expect(auth.exchangeFromTrustedGateway).toHaveBeenCalledWith('dev-99');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/device
  // ---------------------------------------------------------------------------
  describe('deviceSession', () => {
    it('should issue tokens for valid credentials', async () => {
      auth.exchangeDeviceCredentials.mockResolvedValue({
        access_token: 'at-device',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await controller.deviceSession({
        device_id: 'dev-1',
        device_secret: 's3cret',
      });

      expect(auth.exchangeDeviceCredentials).toHaveBeenCalledWith(
        'dev-1',
        's3cret',
      );
      expect(result.access_token).toBe('at-device');
    });

    it('should pass empty strings when body fields are missing', async () => {
      auth.exchangeDeviceCredentials.mockRejectedValue(
        new Error('should not reach'),
      );

      await expect(controller.deviceSession({})).rejects.toThrow();
      expect(auth.exchangeDeviceCredentials).toHaveBeenCalledWith('', '');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/token
  // ---------------------------------------------------------------------------
  describe('refresh', () => {
    it('should issue new tokens for a valid refresh token', async () => {
      auth.refreshAccessToken.mockResolvedValue({
        access_token: 'new-at',
        refresh_token: 'new-rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await controller.refresh({
        refresh_token: 'some.valid.jwt',
      });

      expect(auth.refreshAccessToken).toHaveBeenCalledWith('some.valid.jwt');
      expect(result.access_token).toBe('new-at');
    });

    it('should trim the refresh token', async () => {
      auth.refreshAccessToken.mockResolvedValue({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 900,
      });

      await controller.refresh({ refresh_token: '  tok  ' });

      expect(auth.refreshAccessToken).toHaveBeenCalledWith('tok');
    });

    it('should 400 when refresh_token is missing', async () => {
      await expect(controller.refresh({})).rejects.toThrow(BadRequestException);
    });

    it('should 400 when refresh_token is only whitespace after trim', async () => {
      await expect(controller.refresh({ refresh_token: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should include MISSING_REFRESH_TOKEN code in 400 body', async () => {
      try {
        await controller.refresh({});
      } catch (e: any) {
        expect(e.response.code).toBe('MISSING_REFRESH_TOKEN');
        return;
      }
      throw new Error('Expected BadRequestException');
    });
  });
});
