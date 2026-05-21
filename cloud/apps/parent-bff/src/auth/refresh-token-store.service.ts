import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

export interface ParentRefreshTokenRow {
  sub: string;
  email: string;
  household_id: string;
}

/**
 * Parent BFF refresh token store with optional Redis persistence.
 *
 * When `PARENT_REDIS_URL` (or `REDIS_URL` as fallback) is set, tokens are
 * stored in Redis with a TTL matching the refresh token lifetime. Falls back
 * to in-memory Map when Redis is unavailable.
 *
 * Env: `PARENT_REDIS_URL`, `REDIS_URL`, `REDIS_KEY_PREFIX` (default `fp:parent:`).
 */
@Injectable()
export class ParentRefreshTokenStoreService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ParentRefreshTokenStoreService.name);
  private redis?: RedisClientType;
  private readonly memStore = new Map<string, ParentRefreshTokenRow>();

  private get prefix(): string {
    return process.env.REDIS_KEY_PREFIX?.trim() || 'fp:parent:';
  }

  usesRedis(): boolean {
    return this.redis != null;
  }

  async onModuleInit() {
    const url =
      process.env.PARENT_REDIS_URL?.trim() ||
      process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.log(
        'ParentRefreshTokenStore: in-memory backend (no REDIS_URL)',
      );
      return;
    }
    this.redis = createClient({ url });
    this.redis.on('error', (err) =>
      this.logger.error(`ParentRefreshTokenStore Redis: ${err.message}`),
    );
    await this.redis.connect();
    this.logger.log('ParentRefreshTokenStore: Redis backend connected');
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private k(jti: string): string {
    return `${this.prefix}refresh:${jti}`;
  }

  async set(
    jti: string,
    value: ParentRefreshTokenRow,
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

  async get(jti: string): Promise<ParentRefreshTokenRow | undefined> {
    if (this.redis) {
      const raw = await this.redis.get(this.k(jti));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as ParentRefreshTokenRow;
      } catch {
        return undefined;
      }
    }
    return this.memStore.get(jti);
  }

  async del(jti: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(this.k(jti));
      return;
    }
    this.memStore.delete(jti);
  }
}
