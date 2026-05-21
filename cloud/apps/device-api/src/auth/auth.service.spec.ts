import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DeviceRegistryService } from '../devices/device-registry.service';
import { RefreshTokenStoreService } from './refresh-token-store.service';

describe('AuthService', () => {
  let service: AuthService;
  let registry: jest.Mocked<DeviceRegistryService>;
  let refreshStore: jest.Mocked<RefreshTokenStoreService>;

  beforeEach(async () => {
    // Save and clear relevant env vars
    const origAccessSecret = process.env.DEVICE_JWT_ACCESS_SECRET;
    const origRefreshSecret = process.env.DEVICE_JWT_REFRESH_SECRET;
    process.env.DEVICE_JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.DEVICE_JWT_REFRESH_SECRET = 'test-refresh-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DeviceRegistryService,
          useValue: {
            validate: jest.fn(),
            hasDevice: jest.fn(),
          },
        },
        {
          provide: RefreshTokenStoreService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    registry = module.get(DeviceRegistryService) as jest.Mocked<DeviceRegistryService>;
    refreshStore = module.get(RefreshTokenStoreService) as jest.Mocked<RefreshTokenStoreService>;
  });

  afterEach(() => {
    delete process.env.DEVICE_JWT_ACCESS_SECRET;
    delete process.env.DEVICE_JWT_REFRESH_SECRET;
    delete process.env.MTLS_ALLOWED_DEVICE_IDS_JSON;
    delete process.env.MTLS_TRUST_REGISTERED_DEVICES;
  });

  describe('exchangeDeviceCredentials', () => {
    it('should issue tokens for valid credentials', async () => {
      registry.validate.mockReturnValue(true);
      refreshStore.set.mockResolvedValue(undefined);

      const result = await service.exchangeDeviceCredentials('dev-1', 'secret');

      expect(result.token_type).toBe('Bearer');
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
      expect(result.expires_in).toBeGreaterThan(0);
      expect(registry.validate).toHaveBeenCalledWith('dev-1', 'secret');
      expect(refreshStore.set).toHaveBeenCalled();
    });

    it('should throw for invalid credentials', async () => {
      registry.validate.mockReturnValue(false);

      await expect(
        service.exchangeDeviceCredentials('dev-1', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      // First get a valid token
      registry.validate.mockReturnValue(true);
      refreshStore.set.mockResolvedValue(undefined);

      // Use promise to get the token
      return service
        .exchangeDeviceCredentials('dev-1', 'secret')
        .then((tokens) => {
          const result = service.verifyAccessToken(
            `Bearer ${tokens.access_token}`,
          );
          expect(result.device_id).toBe('dev-1');
        });
    });

    it('should throw for missing bearer token', () => {
      expect(() => service.verifyAccessToken(undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw for malformed authorization header', () => {
      expect(() => service.verifyAccessToken('Basic xxx')).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw for random access token', () => {
      expect(() =>
        service.verifyAccessToken('Bearer invalid-token'),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('exchangeFromTrustedGateway', () => {
    it('should issue tokens for allowed mTLS device', async () => {
      process.env.MTLS_ALLOWED_DEVICE_IDS_JSON = JSON.stringify(['mtls-dev-1']);
      // Re-create service with env
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: DeviceRegistryService,
            useValue: { validate: jest.fn(), hasDevice: jest.fn() },
          },
          {
            provide: RefreshTokenStoreService,
            useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
          },
        ],
      }).compile();
      const svc = mod.get(AuthService);
      const store = mod.get(RefreshTokenStoreService) as jest.Mocked<RefreshTokenStoreService>;
      store.set.mockResolvedValue(undefined);

      const result = await svc.exchangeFromTrustedGateway('mtls-dev-1');
      expect(result.token_type).toBe('Bearer');
      expect(result.access_token).toBeTruthy();
    });

    it('should throw for empty device_id', async () => {
      await expect(
        service.exchangeFromTrustedGateway(''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw for non-allowed device', async () => {
      registry.hasDevice.mockReturnValue(false);

      await expect(
        service.exchangeFromTrustedGateway('unknown-device'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should allow registered devices when MTLS_TRUST_REGISTERED_DEVICES=1', async () => {
      process.env.MTLS_TRUST_REGISTERED_DEVICES = '1';
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: DeviceRegistryService,
            useValue: { validate: jest.fn(), hasDevice: jest.fn().mockReturnValue(true) },
          },
          {
            provide: RefreshTokenStoreService,
            useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
          },
        ],
      }).compile();
      const svc = mod.get(AuthService);
      const store = mod.get(RefreshTokenStoreService) as jest.Mocked<RefreshTokenStoreService>;
      store.set.mockResolvedValue(undefined);

      const result = await svc.exchangeFromTrustedGateway('registered-dev');
      expect(result.access_token).toBeTruthy();
    });
  });

  describe('refreshAccessToken', () => {
    it('should issue new tokens for valid refresh token', async () => {
      // First issue tokens to get a refresh token
      registry.validate.mockReturnValue(true);
      refreshStore.set.mockResolvedValue(undefined);
      const tokens = await service.exchangeDeviceCredentials('dev-1', 'secret');

      // Mock the refresh store to return a valid entry
      const jti = 'test-jti';
      refreshStore.get.mockResolvedValue({
        device_id: 'dev-1',
        exp: Date.now() + 3600000,
      });
      // Need to create a proper refresh token for testing
      const jwt = await import('jsonwebtoken');
      const refreshToken = jwt.sign(
        { typ: 'device_refresh', sub: 'dev-1', jti },
        'test-refresh-secret',
        { expiresIn: '7d' },
      );

      const result = await service.refreshAccessToken(refreshToken);
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
    });

    it('should throw for malformed refresh token', async () => {
      await expect(
        service.refreshAccessToken('not-a-valid-jwt'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
