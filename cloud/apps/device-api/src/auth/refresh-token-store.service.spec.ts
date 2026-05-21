import { Test, TestingModule } from '@nestjs/testing';
import { RefreshTokenStoreService } from './refresh-token-store.service';

describe('RefreshTokenStoreService', () => {
  let service: RefreshTokenStoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RefreshTokenStoreService],
    }).compile();
    service = module.get(RefreshTokenStoreService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('memory backend (default)', () => {
    it('should report usesRedis as false', () => {
      expect(service.usesRedis()).toBe(false);
    });

    it('should store and retrieve a token', async () => {
      await service.set('jti-1', { device_id: 'dev-1', exp: Date.now() + 3600000 }, 3600);
      const result = await service.get('jti-1');
      expect(result).toBeDefined();
      expect(result!.device_id).toBe('dev-1');
    });

    it('should return undefined for unknown jti', async () => {
      const result = await service.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should delete a token', async () => {
      await service.set('jti-2', { device_id: 'dev-2', exp: Date.now() + 3600000 }, 3600);
      await service.del('jti-2');
      const result = await service.get('jti-2');
      expect(result).toBeUndefined();
    });

    it('should handle delete on nonexistent token', async () => {
      await expect(service.del('nonexistent')).resolves.toBeUndefined();
    });

    it('should overwrite existing jti on set', async () => {
      await service.set('jti-3', { device_id: 'dev-3', exp: 100 }, 3600);
      await service.set('jti-3', { device_id: 'dev-4', exp: 200 }, 3600);
      const result = await service.get('jti-3');
      expect(result!.device_id).toBe('dev-4');
      expect(result!.exp).toBe(200);
    });
  });
});
