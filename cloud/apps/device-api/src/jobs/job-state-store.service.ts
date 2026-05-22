import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { createClient, type RedisClientType } from 'redis';
import type { JobRecord } from './job.types';

const RELEASE_ADVANCE_LOCK_LUA =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface PersistedJobsBlob {
  v: 1;
  jobs: JobRecord[];
  createIdempotency: [string, string][];
  printAckIdempotency: [string, { job_id: string; accepted_at: string }][];
}

/**
 * Job 与幂等键存储：**内存**（默认）或 **`REDIS_URL`**（多 `device-api` 实例共享）。
 *
 * **跨副本推进锁**：`POST /v1/jobs/{id}/advance` 在 Redis 模式下对 `job:adv:{id}` 使用 **SET NX + 随机 token**，释放时用 **Lua** 校验 token 再 DEL。
 *
 * **冷迁移 / 导出**：`JOB_REDIS_IMPORT_FILE=1` + `JOBS_PERSISTENCE_PATH` 在连上 Redis 后把 JSON 灌入；`JOB_FILE_EXPORT_ON_SHUTDOWN=1` 在退出前 **SCAN** 写出 JSON（`JOB_FILE_EXPORT_PATH` 可选）。
 */
@Injectable()
export class JobStateStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobStateStoreService.name);
  private redis?: RedisClientType;
  private readonly memJobs = new Map<string, JobRecord>();
  private readonly memCreate = new Map<string, string>();
  private readonly memPrint = new Map<
    string,
    { job_id: string; accepted_at: string }
  >();

  private get prefix(): string {
    return process.env.REDIS_KEY_PREFIX?.trim() || 'fp:';
  }

  private ttlSec(): number {
    return Math.min(
      Math.max(Number(process.env.JOB_REDIS_TTL_SEC ?? 604_800), 300),
      30 * 86400,
    );
  }

  private advanceLockTtlSec(): number {
    return Math.min(
      Math.max(Number(process.env.JOB_ADVANCE_LOCK_TTL_SEC ?? 120), 15),
      600,
    );
  }

  private advanceLockWaitMs(): number {
    return Math.min(
      Math.max(Number(process.env.JOB_ADVANCE_LOCK_WAIT_MS ?? 5000), 200),
      60_000,
    );
  }

  /** 已配置并创建了 Redis 客户端（连接中或已就绪均走 Redis 命令队列）。 */
  usesRedis(): boolean {
    return this.redis != null;
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.log('JobStateStore: in-memory backend (no REDIS_URL)');
      return;
    }
    this.redis = createClient({ url });
    this.redis.on('error', (err) =>
      this.logger.error(`Redis: ${err.message}`),
    );
    await this.redis.connect();
    this.logger.log('JobStateStore: Redis backend connected');

    await this.importFromPersistenceFileIfRequested();
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.exportToPersistenceFileIfRequested();
      await this.redis.quit().catch(() => undefined);
    }
  }

  private kJob(id: string): string {
    return `${this.prefix}job:${id}`;
  }

  private kAdv(jobId: string): string {
    return `${this.prefix}job:adv:${jobId}`;
  }

  private kCreate(idemKey: string): string {
    return `${this.prefix}idem:create:${idemKey}`;
  }

  private kPrint(idemKey: string): string {
    return `${this.prefix}idem:print:${idemKey}`;
  }

  /**
   * 在 `JOB_ADVANCE_LOCK_WAIT_MS` 内重试 **SET NX**，成功返回 **token**；超时返回 `null`（调用方应只读最新 Job，不自推一档）。
   */
  async acquireJobAdvanceLock(jobId: string): Promise<string | null> {
    if (!this.redis) return null;
    const key = this.kAdv(jobId);
    const ttl = this.advanceLockTtlSec();
    const deadline = Date.now() + this.advanceLockWaitMs();
    while (Date.now() < deadline) {
      const token = randomUUID();
      const r = await this.redis.set(key, token, { NX: true, EX: ttl });
      if (r === 'OK') return token;
      await sleep(15 + Math.floor(Math.random() * 35));
    }
    this.logger.warn(
      `job advance lock wait exceeded job_id=${jobId} (another replica may be advancing)`,
    );
    return null;
  }

  async releaseJobAdvanceLock(jobId: string, token: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.eval(RELEASE_ADVANCE_LOCK_LUA, {
        keys: [this.kAdv(jobId)],
        arguments: [token],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`release advance lock failed job_id=${jobId}: ${msg}`);
    }
  }

  private async importFromPersistenceFileIfRequested(): Promise<void> {
    if (!this.redis) return;
    const want = ['1', 'true', 'yes'].includes(
      (process.env.JOB_REDIS_IMPORT_FILE ?? '').toLowerCase(),
    );
    if (!want) return;

    const path = process.env.JOBS_PERSISTENCE_PATH?.trim();
    if (!path) {
      this.logger.warn(
        'JOB_REDIS_IMPORT_FILE set but JOBS_PERSISTENCE_PATH is empty; skip import',
      );
      return;
    }
    const overwrite = ['1', 'true', 'yes'].includes(
      (process.env.JOB_REDIS_IMPORT_OVERWRITE ?? '').toLowerCase(),
    );

    let raw: string;
    try {
      raw = fs.readFileSync(path, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Redis import: cannot read ${path}: ${msg}`);
      return;
    }

    let data: PersistedJobsBlob;
    try {
      data = JSON.parse(raw) as PersistedJobsBlob;
    } catch {
      this.logger.warn('Redis import: invalid JSON');
      return;
    }
    if (data?.v !== 1 || !Array.isArray(data.jobs)) {
      this.logger.warn('Redis import: unsupported blob version');
      return;
    }

    let jobsN = 0;
    for (const row of data.jobs) {
      if (!row?.job_id) continue;
      if (!overwrite) {
        const ex = await this.redis.get(this.kJob(row.job_id));
        if (ex) continue;
      }
      await this.redis.set(this.kJob(row.job_id), JSON.stringify(row), {
        EX: this.ttlSec(),
      });
      jobsN++;
    }

    let createN = 0;
    for (const [k, v] of data.createIdempotency ?? []) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      if (!overwrite) {
        const ok = await this.redis.set(this.kCreate(k), v, {
          NX: true,
          EX: this.ttlSec(),
        });
        if (ok === 'OK') createN++;
      } else {
        await this.redis.set(this.kCreate(k), v, { EX: this.ttlSec() });
        createN++;
      }
    }

    let printN = 0;
    for (const [k, v] of data.printAckIdempotency ?? []) {
      if (typeof k !== 'string' || !v?.job_id || !v?.accepted_at) continue;
      const payload = JSON.stringify(v);
      if (!overwrite) {
        const ok = await this.redis.set(this.kPrint(k), payload, {
          NX: true,
          EX: this.ttlSec(),
        });
        if (ok === 'OK') printN++;
      } else {
        await this.redis.set(this.kPrint(k), payload, { EX: this.ttlSec() });
        printN++;
      }
    }

    this.logger.log(
      `Redis cold import from ${path}: jobs=${jobsN}, create_idem=${createN}, print_idem=${printN} (overwrite=${overwrite})`,
    );
  }

  private async exportToPersistenceFileIfRequested(): Promise<void> {
    if (!this.redis) return;
    const want = ['1', 'true', 'yes'].includes(
      (process.env.JOB_FILE_EXPORT_ON_SHUTDOWN ?? '').toLowerCase(),
    );
    if (!want) return;

    const path =
      process.env.JOB_FILE_EXPORT_PATH?.trim() ||
      process.env.JOBS_PERSISTENCE_PATH?.trim();
    if (!path) {
      this.logger.warn(
        'JOB_FILE_EXPORT_ON_SHUTDOWN set but no JOB_FILE_EXPORT_PATH or JOBS_PERSISTENCE_PATH; skip export',
      );
      return;
    }

    const jobs: JobRecord[] = [];
    const createIdempotency: [string, string][] = [];
    const printAckIdempotency: [string, { job_id: string; accepted_at: string }][] =
      [];

    const jobPat = `${this.prefix}job:*`;
    const createPat = `${this.prefix}idem:create:*`;
    const printPat = `${this.prefix}idem:print:*`;

    const scanKeys = async (match: string): Promise<string[]> => {
      const out: string[] = [];
      let cursor = 0;
      do {
        const r = await this.redis!.scan(cursor, { MATCH: match, COUNT: 200 });
        cursor =
          typeof r.cursor === 'number' ? r.cursor : Number(r.cursor);
        out.push(...r.keys);
      } while (cursor !== 0);
      return out;
    };

    try {
      for (const key of await scanKeys(jobPat)) {
        if (key.includes(`${this.prefix}job:adv:`)) continue;
        const raw = await this.redis.get(key);
        if (!raw) continue;
        try {
          jobs.push(JSON.parse(raw) as JobRecord);
        } catch {
          /* skip */
        }
      }

      const createPrefix = `${this.prefix}idem:create:`;
      for (const key of await scanKeys(createPat)) {
        if (!key.startsWith(createPrefix)) continue;
        const idemKey = key.slice(createPrefix.length);
        const jobId = await this.redis.get(key);
        if (idemKey && jobId) createIdempotency.push([idemKey, jobId]);
      }

      const printPrefix = `${this.prefix}idem:print:`;
      for (const key of await scanKeys(printPat)) {
        if (!key.startsWith(printPrefix)) continue;
        const idemKey = key.slice(printPrefix.length);
        const raw = await this.redis.get(key);
        if (!idemKey || !raw) continue;
        try {
          const v = JSON.parse(raw) as { job_id: string; accepted_at: string };
          if (v?.job_id && v?.accepted_at)
            printAckIdempotency.push([idemKey, v]);
        } catch {
          /* skip */
        }
      }

      const blob: PersistedJobsBlob = {
        v: 1,
        jobs,
        createIdempotency,
        printAckIdempotency,
      };
      fs.writeFileSync(path, JSON.stringify(blob), 'utf8');
      this.logger.log(
        `Redis SCAN export → ${path}: jobs=${jobs.length}, create_idem=${createIdempotency.length}, print_idem=${printAckIdempotency.length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Redis export failed: ${msg}`);
    }
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    if (this.redis) {
      const raw = await this.redis.get(this.kJob(jobId));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as JobRecord;
      } catch {
        return undefined;
      }
    }
    return this.memJobs.get(jobId);
  }

  async setJob(job: JobRecord): Promise<void> {
    if (this.redis) {
      await this.redis.set(this.kJob(job.job_id), JSON.stringify(job), {
        EX: this.ttlSec(),
      });
      return;
    }
    this.memJobs.set(job.job_id, { ...job });
  }

  async deleteJob(jobId: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(this.kJob(jobId));
      return;
    }
    this.memJobs.delete(jobId);
  }

  async getCreateIdem(idemKey: string): Promise<string | undefined> {
    if (this.redis) {
      const v = await this.redis.get(this.kCreate(idemKey));
      return v ?? undefined;
    }
    return this.memCreate.get(idemKey);
  }

  /** `true` = 获得幂等槽（可写入新 job）；`false` = 已有他者占用。 */
  async setCreateIdemNx(
    idemKey: string,
    jobId: string,
  ): Promise<boolean> {
    const ttl = this.ttlSec();
    if (this.redis) {
      const r = await this.redis.set(this.kCreate(idemKey), jobId, {
        NX: true,
        EX: ttl,
      });
      return r === 'OK';
    }
    if (this.memCreate.has(idemKey)) return false;
    this.memCreate.set(idemKey, jobId);
    return true;
  }

  async getPrintIdem(idemKey: string): Promise<
    | {
        job_id: string;
        accepted_at: string;
      }
    | undefined
  > {
    if (this.redis) {
      const raw = await this.redis.get(this.kPrint(idemKey));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as { job_id: string; accepted_at: string };
      } catch {
        return undefined;
      }
    }
    return this.memPrint.get(idemKey);
  }

  async setPrintIdem(
    idemKey: string,
    value: { job_id: string; accepted_at: string },
  ): Promise<void> {
    if (this.redis) {
      await this.redis.set(this.kPrint(idemKey), JSON.stringify(value), {
        EX: this.ttlSec(),
      });
      return;
    }
    this.memPrint.set(idemKey, { ...value });
  }

  /** 将内存中的全部 Job 与幂等表导出（仅内存模式，供文件镜像）。 */
  exportMemorySnapshot(): {
    jobs: JobRecord[];
    createIdempotency: [string, string][];
    printAckIdempotency: [string, { job_id: string; accepted_at: string }][];
  } {
    return {
      jobs: [...this.memJobs.values()],
      createIdempotency: [...this.memCreate.entries()],
      printAckIdempotency: [...this.memPrint.entries()],
    };
  }

  /** 内存模式：从文件种子导入（仅 `!usesRedis()` 时由 JobsService 调用）。 */
  seedMemoryFromJobs(
    jobs: JobRecord[],
    create: [string, string][],
    print: [string, { job_id: string; accepted_at: string }][],
  ): void {
    if (this.redis) return;
    for (const j of jobs) {
      if (j?.job_id) this.memJobs.set(j.job_id, j);
    }
    for (const [k, v] of create) {
      if (typeof k === 'string' && typeof v === 'string')
        this.memCreate.set(k, v);
    }
    for (const [k, v] of print) {
      if (typeof k === 'string' && v?.job_id && v?.accepted_at)
        this.memPrint.set(k, v);
    }
  }
}
