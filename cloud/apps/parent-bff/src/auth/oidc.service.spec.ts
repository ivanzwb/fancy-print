import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { OidcService } from './oidc.service';
import { ParentAuthService } from './parent-auth.service';

// Mock openid-client entirely (ESM-only — Jest cannot parse it without transforms)
jest.mock('openid-client', () => ({}));

describe('OidcService', () => {
  let service: OidcService;

  beforeEach(async () => {
    delete process.env.OIDC_ISSUER;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcService,
        {
          provide: ParentAuthService,
          useValue: {
            issueTokensFromOidc: jest.fn().mockResolvedValue({
              access_token: 'at-oidc',
              refresh_token: 'rt-oidc',
              token_type: 'Bearer' as const,
              expires_in: 3600,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(OidcService);
  });

  describe('isConfigured', () => {
    it('returns false when OIDC_ISSUER is not set', () => {
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('throws when not configured', async () => {
      await expect(service.getAuthorizationUrl()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('handleCallback', () => {
    it('throws when not configured', async () => {
      await expect(
        service.handleCallback('http://example.com/cb', 'cv', 'st'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
