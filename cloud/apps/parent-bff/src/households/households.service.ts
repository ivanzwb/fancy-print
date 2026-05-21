import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

export interface HouseholdDevice {
  device_id: string;
  online: boolean;
  last_seen: string | null;
}

export interface HouseholdPolicy {
  version: number;
  tier: string;
  remote_print_gate: boolean;
}

export interface ApprovalRecord {
  household_id: string;
  job_id: string;
  status: 'approved' | 'rejected';
  decided_at: string;
}

export interface JobEntry {
  job_id: string;
  content_mode: string;
  state: string;
  created_at: string;
}

/**
 * 家庭数据持久化服务 — 对接 Redis（可选）。
 *
 * 当 `REDIS_URL`（或 `PARENT_REDIS_URL`）已配置时，所有绑定、策略、审批
 * 记录写入 Redis；否则回退到进程内 Map（单实例开发用）。
 *
 * Redis Key 空间（前缀 `fp:parent:hh:{householdId}`）：
 * - `fp:parent:hh:{id}:devices`     → Set of device_ids
 * - `fp:parent:hh:{id}:device:{did}`  → Hash { online, last_seen }
 * - `fp:parent:hh:{id}:policy`       → Hash { version, tier, remote_print_gate }
 * - `fp:parent:hh:{id}:approvals`    → Sorted Set (job_id 按 decided_at 排序)
 * - `fp:parent:ido:{op}:{hh}:{jobId}:{key}` → 幂等键
 * - `fp:parent:hh:{id}:jobs`         → Sorted Set (job_id 按 created_at 排序)
 * - `fp:parent:hh:{id}:job:{jid}`    → Hash { content_mode, state, created_at }
 */
@Injectable()
export class HouseholdsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HouseholdsService.name);
  private redis?: RedisClientType;

  // ── In-memory fallbacks ──────────────────────────────────────────
  private readonly memHouseholdDevices = new Map<
    string,
    Map<string, HouseholdDevice>
  >();
  private readonly memPolicies = new Map<string, HouseholdPolicy>();
  private readonly memApprovals = new Map<string, ApprovalRecord[]>();
  private readonly memIdempotency = new Map<string, Record<string, unknown>>();
  private readonly memJobs = new Map<string, JobEntry[]>();

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
      this.logger.log('HouseholdsService: in-memory backend (no REDIS_URL)');
      return;
    }
    this.redis = createClient({ url });
    this.redis.on('error', (err) =>
      this.logger.error(`HouseholdsService Redis: ${err.message}`),
    );
    await this.redis.connect();
    this.logger.log('HouseholdsService: Redis backend connected');
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  // ── Key helpers ──────────────────────────────────────────────────

  private hhKey(householdId: string, ...segments: string[]): string {
    return `${this.prefix}hh:${householdId}:${segments.join(':')}`;
  }

  private idoKey(
    op: string,
    householdId: string,
    jobId: string,
    idempotencyKey: string,
  ): string {
    return `${this.prefix}ido:${op}:${householdId}:${jobId}:${idempotencyKey}`;
  }

  private requireIdempotencyKey(
    op: string,
    idempotencyKey: string | undefined,
  ): string {
    const raw = idempotencyKey?.trim();
    if (!raw) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: `Idempotency-Key header is required for ${op}`,
      });
    }
    return raw;
  }

  private async checkIdempotency(
    key: string,
  ): Promise<Record<string, unknown> | null> {
    if (this.redis) {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return this.memIdempotency.get(key) ?? null;
  }

  private async setIdempotency(
    key: string,
    result: Record<string, unknown>,
    ttlSec = 86400,
  ): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(result), { EX: ttlSec });
      return;
    }
    this.memIdempotency.set(key, result);
  }

  // ── Devices ──────────────────────────────────────────────────────

  async getDevices(householdId: string): Promise<HouseholdDevice[]> {
    const r = this.redis;
    if (r) {
      const deviceIds = await r.sMembers(
        this.hhKey(householdId, 'devices'),
      );
      if (deviceIds.length === 0) return [];
      const entries = await Promise.all(
        deviceIds.map(async (did) => {
          const raw = await r.hGetAll(
            this.hhKey(householdId, 'device', did),
          );
          return {
            device_id: did,
            online: raw.online === 'true',
            last_seen: raw.last_seen ?? null,
          } as HouseholdDevice;
        }),
      );
      return entries;
    }
    return Array.from(
      this.memHouseholdDevices.get(householdId)?.values() ?? [],
    );
  }

  async bindDevice(
    householdId: string,
    deviceId: string,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const key = this.requireIdempotencyKey('bind', idempotencyKey);
    const ido = this.idoKey('bind', householdId, '', key);

    const cached = await this.checkIdempotency(ido);
    if (cached) return { ...cached };

    const result = {
      household_id: householdId,
      device_id: deviceId,
      status: 'bound',
    };

    if (this.redis) {
      await this.redis.sAdd(this.hhKey(householdId, 'devices'), deviceId);
      await this.redis.hSet(this.hhKey(householdId, 'device', deviceId), {
        online: 'true',
        last_seen: new Date().toISOString(),
      });
      await this.setIdempotency(ido, result);
      return result;
    }

    let devices = this.memHouseholdDevices.get(householdId);
    if (!devices) {
      devices = new Map();
      this.memHouseholdDevices.set(householdId, devices);
    }
    devices.set(deviceId, {
      device_id: deviceId,
      online: true,
      last_seen: new Date().toISOString(),
    });
    this.memIdempotency.set(ido, result);
    return result;
  }

  async unbindDevice(
    householdId: string,
    deviceId: string,
  ): Promise<Record<string, unknown>> {
    if (this.redis) {
      await this.redis.sRem(this.hhKey(householdId, 'devices'), deviceId);
      await this.redis.del(this.hhKey(householdId, 'device', deviceId));
    } else {
      const devices = this.memHouseholdDevices.get(householdId);
      if (devices) devices.delete(deviceId);
    }
    return {
      household_id: householdId,
      device_id: deviceId,
      status: 'unbound',
    };
  }

  // ── Policy ───────────────────────────────────────────────────────

  async getPolicy(householdId: string): Promise<HouseholdPolicy> {
    if (this.redis) {
      const raw = await this.redis.hGetAll(this.hhKey(householdId, 'policy'));
      if (raw.version) {
        return {
          version: Number(raw.version),
          tier: raw.tier ?? 'A',
          remote_print_gate: raw.remote_print_gate === 'true',
        };
      }
    } else {
      const p = this.memPolicies.get(householdId);
      if (p) return { ...p };
    }
    return { version: 1, tier: 'A', remote_print_gate: false };
  }

  async patchPolicy(
    householdId: string,
    expectedVersion: number | undefined,
    remotePrintGate: boolean | undefined,
  ): Promise<Record<string, unknown>> {
    const current = await this.getPolicy(householdId);

    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        code: 'POLICY_VERSION_CONFLICT',
        message: 'Policy version mismatch; refresh and retry',
      });
    }

    const next = {
      version: current.version + 1,
      tier: current.tier,
      remote_print_gate: remotePrintGate ?? current.remote_print_gate,
    };

    if (this.redis) {
      await this.redis.hSet(this.hhKey(householdId, 'policy'), {
        version: String(next.version),
        tier: next.tier,
        remote_print_gate: String(next.remote_print_gate),
      });
    } else {
      this.memPolicies.set(householdId, { ...next });
    }

    return {
      household_id: householdId,
      version: next.version,
      remote_print_gate: next.remote_print_gate,
      applied: true,
    };
  }

  // ── Approvals ────────────────────────────────────────────────────

  async getPendingApprovals(householdId: string): Promise<ApprovalRecord[]> {
    const r = this.redis;
    if (r) {
      const raw = await r.zRangeByScore(
        this.hhKey(householdId, 'approvals'),
        0,
        Date.now(),
        { LIMIT: { offset: 0, count: 50 } },
      );
      const items: ApprovalRecord[] = [];
      for (const json of raw) {
        try {
          items.push(JSON.parse(json) as ApprovalRecord);
        } catch {
          // skip malformed
        }
      }
      // zRangeByScore returns ascending; reverse for newest-first
      items.reverse();
      return items;
    }
    return this.memApprovals.get(householdId) ?? [];
  }

  async approve(
    householdId: string,
    jobId: string,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const key = this.requireIdempotencyKey('approve', idempotencyKey);
    const ido = this.idoKey('approve', householdId, jobId, key);

    const cached = await this.checkIdempotency(ido);
    if (cached) return { ...cached };

    const result: Record<string, unknown> = {
      household_id: householdId,
      job_id: jobId,
      status: 'approved',
    };

    const record: ApprovalRecord = {
      household_id: householdId,
      job_id: jobId,
      status: 'approved',
      decided_at: new Date().toISOString(),
    };

    if (this.redis) {
      await this.redis.zAdd(this.hhKey(householdId, 'approvals'), {
        score: Date.now(),
        value: JSON.stringify(record),
      });
      await this.setIdempotency(ido, result);
    } else {
      const list = this.memApprovals.get(householdId) ?? [];
      list.push(record);
      this.memApprovals.set(householdId, list);
      this.memIdempotency.set(ido, result);
    }

    return result;
  }

  async reject(
    householdId: string,
    jobId: string,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const key = this.requireIdempotencyKey('reject', idempotencyKey);
    const ido = this.idoKey('reject', householdId, jobId, key);

    const cached = await this.checkIdempotency(ido);
    if (cached) return { ...cached };

    const result: Record<string, unknown> = {
      household_id: householdId,
      job_id: jobId,
      status: 'rejected',
    };

    const record: ApprovalRecord = {
      household_id: householdId,
      job_id: jobId,
      status: 'rejected',
      decided_at: new Date().toISOString(),
    };

    if (this.redis) {
      await this.redis.zAdd(this.hhKey(householdId, 'approvals'), {
        score: Date.now(),
        value: JSON.stringify(record),
      });
      await this.setIdempotency(ido, result);
    } else {
      const list = this.memApprovals.get(householdId) ?? [];
      list.push(record);
      this.memApprovals.set(householdId, list);
      this.memIdempotency.set(ido, result);
    }

    return result;
  }

  // ── Jobs ─────────────────────────────────────────────────────────

  async getJobs(
    householdId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: JobEntry[]; page: { next_cursor: string | null } }> {
    const r = this.redis;
    if (r) {
      // Fetch (limit+1) items newer than cursor, then reverse for newest-first
      const maxScore = cursor ? Number(cursor) : Date.now();
      const raw = await r.zRangeByScore(
        this.hhKey(householdId, 'jobs'),
        0,
        maxScore,
        { LIMIT: { offset: 0, count: limit + 1 } },
      );
      const allItems: JobEntry[] = [];
      for (const json of raw) {
        try {
          allItems.push(JSON.parse(json) as JobEntry);
        } catch {
          // skip malformed
        }
      }
      allItems.reverse(); // newest first
      const items = allItems.slice(0, limit);
      const nextCursor =
        raw.length > limit
          ? String(allItems[limit - 1]?.created_at ?? '')
          : null;
      return { items, page: { next_cursor: nextCursor } };
    }

    const all = this.memJobs.get(householdId) ?? [];
    const sorted = [...all].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const startIdx = cursor
      ? sorted.findIndex((j) => j.job_id <= cursor) + 1
      : 0;
    const items = sorted.slice(startIdx, startIdx + limit);
    const nextCursor =
      sorted.length > startIdx + limit
        ? sorted[startIdx + limit - 1]?.job_id ?? null
        : null;
    return { items, page: { next_cursor: nextCursor } };
  }

  /**
   * 供 device-api 或内部迁移同步调用 — 将 job 摘要写入 Redis。
   */
  async recordJob(
    householdId: string,
    job: JobEntry,
  ): Promise<void> {
    if (this.redis) {
      await this.redis.zAdd(this.hhKey(householdId, 'jobs'), {
        score: new Date(job.created_at).getTime(),
        value: JSON.stringify(job),
      });
      await this.redis.expire(this.hhKey(householdId, 'jobs'), 604800); // 7d TTL
      return;
    }
    const list = this.memJobs.get(householdId) ?? [];
    list.push(job);
    this.memJobs.set(householdId, list);
  }
}
