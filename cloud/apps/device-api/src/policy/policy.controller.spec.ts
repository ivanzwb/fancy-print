import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

function mockReply(): jest.Mocked<FastifyReply> {
  return { status: jest.fn(), header: jest.fn() } as any;
}

describe('PolicyController', () => {
  let controller: PolicyController;
  let policy: jest.Mocked<PolicyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PolicyController],
      providers: [
        {
          provide: PolicyService,
          useValue: {
            maybeNotModified: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(PolicyController);
    policy = module.get(PolicyService) as jest.Mocked<PolicyService>;
  });

  // ---------------------------------------------------------------------------
  // GET /v1/policy
  // ---------------------------------------------------------------------------
  describe('get', () => {
    it('should return 304 when not modified', () => {
      policy.maybeNotModified.mockReturnValue({
        notModified: true,
        etag: undefined,
        body: undefined,
      });
      const reply = mockReply();

      const result = controller.get('some-etag', reply);

      expect(result).toBeUndefined();
      expect(reply.status).toHaveBeenCalledWith(304);
      expect(policy.maybeNotModified).toHaveBeenCalledWith('some-etag');
    });

    it('should return policy body with ETag when modified', () => {
      policy.maybeNotModified.mockReturnValue({
        notModified: false,
        etag: 'v2-etag',
        body: {
          version: 1,
          schema: 'fancy-print.policy.v1',
          content_modes_allowed: ['coloring_quiet_book'],
          features: { remote_print_gate: false },
        },
      });
      const reply = mockReply();

      const result = controller.get(undefined, reply);

      expect(reply.header).toHaveBeenCalledWith('ETag', 'v2-etag');
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=60',
      );
      expect(result).toEqual({
        version: 1,
        schema: 'fancy-print.policy.v1',
        content_modes_allowed: ['coloring_quiet_book'],
        features: { remote_print_gate: false },
      });
    });

    it('should pass undefined if-none-match when no header', () => {
      policy.maybeNotModified.mockReturnValue({
        notModified: false,
        etag: 'etag',
        body: {
          version: 1,
          schema: 'fancy-print.policy.v1',
          content_modes_allowed: ['coloring_quiet_book'],
          features: { remote_print_gate: false },
        },
      });

      controller.get(undefined, mockReply());

      expect(policy.maybeNotModified).toHaveBeenCalledWith(undefined);
    });
  });
});
