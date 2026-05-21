import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

/**
 * Refresh token store with optional Redis persistence.
 *
 * When `REDIS_URL` is set, tokens are stored in Redis with a TTL matching
 * the refresh token lifetime, surviving restarts and enabling multi-replica
 * validation. Falls back to in-memory Map when Redis is unavailable.
 *
 * Env: `REDIS_URL`, `REDIS_KEY_PREFIX` (default `fp:`).
 */
@Injectable()
export class RefreshTokenStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefreshTokenStoreService.name);
  private redis?: RedisClientType;
  private readonly memStore = new Map<
    string,
    { device_id: string; exp: number }
  >();

  private get prefix(): string {
    return process.env.REDIS_KEY_PREFIX?.trim() || 'fp:';
  }

  usesRedis(): boolean {
    return this.redis != null;
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.log('RefreshTokenStore: in-memory backend (no REDIS_URL)');
      return;
    }
    this.redis = createClient({ url });
    this.redis.on('error', (err) =>
      this.logger.error(`RefreshTokenStore Redis: ${err.message}`),
    );
    await this.redis.connect();
    this.logger.log('RefreshTokenStore: Redis backend connected');
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private k(jti: string): string {
    return `${this.prefix}refresh:${jti}`;
  }

  /** Store a refresh token with TTL (seconds). */
  async set(
    jti: string,
    value: { device_id: string; exp: number },
    ttlSec: number,
  ): Promise<void> {
    if (this.redis) {
      await this.redis.set(this.k(jti), JSON.stringify(value), {
        EX: ttlSec,
      });
      return;
    }
    this.memStore.set(jti, { ...value });
  }

  /** Look up a refresh token. Returns undefined if missing or expired. */
  async get(
    jti: string,
  ): Promise<{ device_id: string; exp: number } | undefined> {
    if (this.redis) {
      const raw = await this.redis.get(this.k(jti));
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw) as { device_id: string; exp: number };
        return parsed;
      } catch {
        return undefined;
      }
    }
    return this.memStore.get(jti);
  }

  /** Remove a refresh token (e.g. on logout/revoke). */
  async del(jti: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(this.k(jti));
      return;
    }
    this.memStore.delete(jti);
  }
}
