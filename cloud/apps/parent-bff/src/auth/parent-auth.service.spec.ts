import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ParentAuthService } from './parent-auth.service';
import { ParentRefreshTokenStoreService } from './refresh-token-store.service';

describe('ParentAuthService', () => {
  let service: ParentAuthService;
  let refreshStore: jest.Mocked<ParentRefreshTokenStoreService>;

  beforeEach(async () => {
    const origAccess = process.env.PARENT_JWT_ACCESS_SECRET;
    const origRefresh = process.env.PARENT_JWT_REFRESH_SECRET;
    process.env.PARENT_JWT_ACCESS_SECRET = 'parent-test-access-secret';
    process.env.PARENT_JWT_REFRESH_SECRET = 'parent-test-refresh-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentAuthService,
        {
          provide: ParentRefreshTokenStoreService,
          useValue: {
            set: jest.fn().mockResolvedValue(undefined),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ParentAuthService);
    refreshStore = module.get(
      ParentRefreshTokenStoreService,
    ) as jest.Mocked<ParentRefreshTokenStoreService>;
  });

  afterEach(() => {
    delete process.env.PARENT_JWT_ACCESS_SECRET;
    delete process.env.PARENT_JWT_REFRESH_SECRET;
  });

  describe('login', () => {
    it('returns tokens with valid credentials', async () => {
      const result = await service.login('parent@test.com', 'dev');
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBeGreaterThan(0);
    });

    it('throws on wrong password', async () => {
      await expect(
        service.login('parent@test.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws on missing email', async () => {
      await expect(
        service.login('', 'dev'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyAccess', () => {
    let token: string;

    beforeEach(async () => {
      const r = await service.login('parent@test.com', 'dev');
      token = r.access_token;
    });

    it('returns principal for valid token', () => {
      const p = service.verifyAccess(`Bearer ${token}`);
      expect(p.email).toBe('parent@test.com');
      expect(p.household_id).toBeTruthy();
    });

    it('throws on missing header', () => {
      expect(() => service.verifyAccess(undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws on bad token', () => {
      expect(() => service.verifyAccess('Bearer bad-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws on non-Bearer scheme', () => {
      expect(() => service.verifyAccess('Basic dGVzdA==')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    it('rotates refresh token', async () => {
      const login = await service.login('refresh@test.com', 'dev');
      refreshStore.get.mockResolvedValue({
        sub: `parent:refresh@test.com`,
        email: 'refresh@test.com',
        household_id: 'hh-demo',
      });
      const result = await service.refresh(login.refresh_token);
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
    });

    it('rejects revoked token', async () => {
      refreshStore.get.mockResolvedValue(undefined);
      await expect(service.refresh('some-invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
