import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { JobRecord, JobState } from './job.types';
import { JobStateStoreService } from './job-state-store.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { S3AudioStagingService } from '../adapters/s3-audio-staging.service';
import { VendorFacadeService } from '../adapters/vendor-facade.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PolicyService } from '../policy/policy.service';

const PIPELINE_AFTER_AUDIO: JobState[] = [
  'audio_received',
  'asr_complete',
  'moderation_passed',
  'image_generation',
  'preview_ready',
];

const MAX_AUDIO_B64_LEN = 4_000_000;

function capAudioBase64(s: string | undefined): string | undefined {
  if (s === undefined || typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > MAX_AUDIO_B64_LEN ? t.slice(0, MAX_AUDIO_B64_LEN) : t;
}

function cloneJobForApi(job: JobRecord): JobRecord {
  const j = { ...job };
  delete j.audio_base64;
  delete j.audio_s3_key;
  delete j.audio_s3_bucket;
  delete j.audio_chunk_buffers;
  delete j.pending_preview_image_url;
  delete j.pending_preview_image_base64;
  return j;
}

interface PersistedJobsBlob {
  v: 1;
  jobs: JobRecord[];
  createIdempotency: [string, string][];
  printAckIdempotency: [string, { job_id: string; accepted_at: string }][];
}

@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private persistTimer?: ReturnType<typeof setTimeout>;
  private persistPath?: string;

  constructor(
    private readonly store: JobStateStoreService,
    private readonly mqtt: MqttService,
    private readonly policy: PolicyService,
    private readonly vendorFacade: VendorFacadeService,
    private readonly pipelineQueue: PipelineQueueService,
    private readonly s3Audio: S3AudioStagingService,
  ) {}

  onApplicationBootstrap() {
    if (this.store.usesRedis()) {
      if (process.env.JOBS_PERSISTENCE_PATH?.trim()) {
        const imp = ['1', 'true', 'yes'].includes(
          (process.env.JOB_REDIS_IMPORT_FILE ?? '').toLowerCase(),
        );
        this.logger.warn(
          imp
            ? 'Redis mode: JOBS_PERSISTENCE_PATH will be used for cold import (JOB_REDIS_IMPORT_FILE=1)'
            : 'Redis mode: JOBS_PERSISTENCE_PATH is not loaded unless JOB_REDIS_IMPORT_FILE=1 (see README)',
        );
      }
      return;
    }

    this.persistPath = process.env.JOBS_PERSISTENCE_PATH?.trim() || undefined;
    if (!this.persistPath) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw) as PersistedJobsBlob;
      if (data?.v === 1 && Array.isArray(data.jobs)) {
        this.store.seedMemoryFromJobs(
          data.jobs,
          data.createIdempotency ?? [],
          data.printAckIdempotency ?? [],
        );
      }
    } catch {
      /* cold start */
    }
  }

  onModuleDestroy() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.flushPersistenceSync();
  }

  async createJob(input: {
    content_mode: string;
    device_id: string;
    idempotencyKey?: string;
    child_profile_id?: string;
  }): Promise<JobRecord> {
    const mode = input.content_mode?.trim();
    if (!mode) {
      throw new BadRequestException({
        code: 'INVALID_CONTENT_MODE',
        message: 'content_mode is required',
      });
    }
    const allowed = this.policy.canonicalBody.content_modes_allowed as readonly string[];
    if (!allowed.includes(mode)) {
      throw new BadRequestException({
        code: 'CONTENT_MODE_NOT_ALLOWED',
        message: `content_mode must be one of: ${allowed.join(', ')}`,
        details: { allowed: [...allowed] },
      });
    }

    const idemKey = input.idempotencyKey
      ? `${input.device_id}:${input.idempotencyKey}`
      : undefined;

    if (idemKey) {
      const existingId = await this.store.getCreateIdem(idemKey);
      if (existingId) {
        const job = await this.store.getJob(existingId);
        if (job) {
          this.assertDevice(job, input.device_id);
          return cloneJobForApi({ ...job });
        }
      }
    }

    const now = new Date().toISOString();
    const jobId = randomUUID();
    const job: JobRecord = {
      job_id: jobId,
      device_id: input.device_id,
      content_mode: mode,
      child_profile_id: input.child_profile_id?.trim() || undefined,
      state: 'created',
      policy_version: 1,
      created_at: now,
      updated_at: now,
    };

    await this.store.setJob(job);

    if (idemKey) {
      const acquired = await this.store.setCreateIdemNx(idemKey, jobId);
      if (!acquired) {
        const winnerId = await this.store.getCreateIdem(idemKey);
        await this.store.deleteJob(jobId);
        const winner = winnerId ? await this.store.getJob(winnerId) : undefined;
        if (winner) {
          this.assertDevice(winner, input.device_id);
          return cloneJobForApi({ ...winner });
        }
      }
    }

    this.mqtt.publishJobStatus(job);
    this.schedulePersist();
    return cloneJobForApi({ ...job });
  }

  /**
   * Pure read-only job lookup. No side effects — does NOT advance the pipeline.
   */
  async getJob(jobId: string, deviceId: string): Promise<JobRecord> {
    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);
    return cloneJobForApi({ ...job });
  }

  /**
   * Explicitly advance the pipeline one step.
   *
   * Returns immediately with the current job state. The actual vendor calls
   * (ASR, moderation, image gen) run in the background via PipelineQueueService
   * to avoid blocking the HTTP request thread.
   *
   * In Redis mode, uses SET NX lock to prevent concurrent advancement by multiple replicas.
   */
  async advanceJob(jobId: string, deviceId: string): Promise<JobRecord> {
    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);

    // Terminal or idle states — no background work needed
    if (
      job.state === 'failed' ||
      job.state === 'print_acknowledged' ||
      job.state === 'preview_ready'
    ) {
      return cloneJobForApi({ ...job });
    }
    if (job.state === 'created') {
      // No audio yet — nothing to advance
      return cloneJobForApi({ ...job });
    }

    // Enqueue background advancement and return current state immediately
    this.pipelineQueue.enqueue(jobId, async () => {
      try {
        if (this.store.usesRedis()) {
          const token = await this.store.acquireJobAdvanceLock(jobId);
          if (token) {
            try {
              const latest = await this.store.getJob(jobId);
              if (!latest) return;
              this.assertDevice(latest, deviceId);
              await this.advancePipelineAsync(latest);
              await this.store.setJob(latest);
              this.mqtt.publishJobStatus(latest);
            } finally {
              await this.store.releaseJobAdvanceLock(jobId, token);
            }
          }
          // Lock not acquired — another replica is advancing, skip
        } else {
          const working = await this.requireJob(jobId);
          await this.advancePipelineAsync(working);
          await this.store.setJob(working);
          this.mqtt.publishJobStatus(working);
          this.schedulePersist();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Background advancement failed job_id=${jobId}: ${msg}`,
        );
      }
    });

    return cloneJobForApi({ ...job });
  }

  async getArtifactRedirectUrl(
    jobId: string,
    deviceId: string,
  ): Promise<string | null> {
    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);
    if (job.state !== 'preview_ready' && job.state !== 'print_acknowledged') {
      return null;
    }
    if (!job.preview_url) return null;
    return job.preview_url;
  }

  /** Shared: stage audio to S3 when configured, or fall back to inline base64. */
  private async storeAudioRef(
    job: JobRecord,
    audioBase64: string,
  ): Promise<void> {
    // When S3 is available, upload immediately and keep only the key in memory.
    if (this.s3Audio.isConfigured()) {
      const staged = await this.s3Audio.stageAudio(job.job_id, audioBase64);
      if (staged) {
        job.audio_s3_key = staged.key;
        job.audio_s3_bucket = staged.bucket;
        delete job.audio_base64;
        return;
      }
      // S3 upload failed — fall through to inline storage
    }
    job.audio_base64 = audioBase64;
    delete job.audio_s3_key;
    delete job.audio_s3_bucket;
  }

  async attachAudio(
    jobId: string,
    deviceId: string,
    audioBase64?: string,
  ): Promise<JobRecord> {
    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);
    if (job.state === 'failed') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: 'Cannot attach audio to failed job',
      });
    }
    if (job.state === 'preview_ready' || job.state === 'print_acknowledged') {
      return cloneJobForApi({ ...job });
    }
    if (job.state !== 'created') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: `Cannot attach audio in state ${job.state}`,
      });
    }
    const capped = capAudioBase64(audioBase64);
    if (capped) {
      await this.storeAudioRef(job, capped);
    }
    delete job.chunks_max_seq;
    delete job.audio_chunk_buffers;
    job.state = 'audio_received';
    job.updated_at = new Date().toISOString();
    await this.store.setJob(job);
    this.mqtt.publishJobStatus(job);
    this.schedulePersist();
    return cloneJobForApi({ ...job });
  }

  async uploadChunk(
    jobId: string,
    deviceId: string,
    body?: { seq?: number; final?: boolean; audio_base64?: string },
  ): Promise<JobRecord> {
    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);
    if (job.state === 'failed') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: 'Cannot upload chunks to failed job',
      });
    }

    const raw = body ?? {};
    const keys = Object.keys(raw);
    const hasSeq = typeof raw.seq === 'number';
    const finalExplicit = 'final' in raw && typeof raw.final === 'boolean';

    if (keys.length === 0) {
      return await this.attachAudio(jobId, deviceId);
    }

    if (!hasSeq && raw.final === true) {
      return await this.attachAudio(jobId, deviceId);
    }

    if (!hasSeq && raw.final === false) {
      throw new BadRequestException({
        code: 'CHUNK_SEQ_REQUIRED',
        message: 'seq is required when final is false',
      });
    }

    if (!hasSeq && !finalExplicit) {
      return await this.attachAudio(jobId, deviceId);
    }

    if (hasSeq) {
      if (!finalExplicit) {
        throw new BadRequestException({
          code: 'CHUNK_FINAL_REQUIRED',
          message: 'When seq is provided, final (boolean) is required',
        });
      }
      const seq = raw.seq as number;
      if (!Number.isInteger(seq) || seq < 0) {
        throw new BadRequestException({
          code: 'INVALID_CHUNK_SEQ',
          message: 'seq must be a non-negative integer',
        });
      }
      if (job.state !== 'created') {
        throw new ConflictException({
          code: 'INVALID_JOB_STATE',
          message: `Cannot upload chunks in state ${job.state}`,
        });
      }
      const hwm = job.chunks_max_seq ?? -1;
      if (seq <= hwm) {
        return cloneJobForApi({ ...job });
      }
      job.chunks_max_seq = seq;
      if (!job.audio_chunk_buffers) job.audio_chunk_buffers = {};
      const frag =
        typeof raw.audio_base64 === 'string' ? raw.audio_base64.trim() : '';
      if (frag) {
        job.audio_chunk_buffers[String(seq)] = frag;
      }
      job.updated_at = new Date().toISOString();
      if (raw.final) {
        const merged = this.mergeAudioChunks(job);
        delete job.chunks_max_seq;
        delete job.audio_chunk_buffers;
        if (merged) {
          await this.storeAudioRef(job, merged);
        }
        job.state = 'audio_received';
        job.updated_at = new Date().toISOString();
        await this.store.setJob(job);
        this.mqtt.publishJobStatus(job);
        this.schedulePersist();
        return cloneJobForApi({ ...job });
      }
      await this.store.setJob(job);
      this.mqtt.publishJobStatus(job);
      this.schedulePersist();
      return cloneJobForApi({ ...job });
    }

    return await this.attachAudio(jobId, deviceId);
  }

  async printAck(
    jobId: string,
    deviceId: string,
    idempotencyKey?: string,
  ): Promise<{
    job_id: string;
    accepted: boolean;
    accepted_at: string;
    idempotent_replay: boolean;
  }> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for print-ack',
      });
    }
    const key = `${deviceId}:${idempotencyKey.trim()}`;
    const cached = await this.store.getPrintIdem(key);
    if (cached) {
      if (cached.job_id !== jobId) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSE',
          message: 'Idempotency-Key already used for a different resource',
        });
      }
      return {
        job_id: jobId,
        accepted: true,
        accepted_at: cached.accepted_at,
        idempotent_replay: true,
      };
    }

    const job = await this.requireJob(jobId);
    this.assertDevice(job, deviceId);
    if (job.state === 'failed') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: 'print-ack not allowed for failed job',
      });
    }
    if (job.state !== 'preview_ready') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: `print-ack not allowed in state ${job.state}`,
      });
    }
    const acceptedAt = new Date().toISOString();
    job.state = 'print_acknowledged';
    job.updated_at = acceptedAt;
    job.print_ack_at = acceptedAt;
    await this.store.setPrintIdem(key, { job_id: jobId, accepted_at: acceptedAt });
    await this.store.setJob(job);
    this.mqtt.publishJobStatus(job);
    this.schedulePersist();
    return {
      job_id: jobId,
      accepted: true,
      accepted_at: acceptedAt,
      idempotent_replay: false,
    };
  }

  private mergeAudioChunks(job: JobRecord): string | undefined {
    const buf = job.audio_chunk_buffers;
    if (!buf || Object.keys(buf).length === 0) return undefined;
    const parts = Object.entries(buf)
      .map(([k, v]) => [Number(k), v] as const)
      .filter(([n]) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a[0] - b[0]);
    let acc = Buffer.alloc(0);
    for (const [, frag] of parts) {
      try {
        acc = Buffer.concat([acc, Buffer.from(frag, 'base64')]);
      } catch {
        throw new BadRequestException({
          code: 'INVALID_AUDIO_CHUNK_BASE64',
          message: 'One or more chunks are not valid base64',
        });
      }
      if (acc.length > MAX_AUDIO_B64_LEN) {
        throw new BadRequestException({
          code: 'AUDIO_ASSEMBLY_TOO_LARGE',
          message: `Assembled audio exceeds ${MAX_AUDIO_B64_LEN} bytes (base64 decoded cap)`,
        });
      }
    }
    if (!acc.length) return undefined;
    return acc.toString('base64');
  }

  private async advancePipelineAsync(job: JobRecord): Promise<void> {
    if (job.state === 'failed' || job.state === 'print_acknowledged') return;

    const idx = PIPELINE_AFTER_AUDIO.indexOf(job.state as JobState);
    if (idx === -1) return;
    if (idx >= PIPELINE_AFTER_AUDIO.length - 1) return;

    const now = new Date();
    const next = PIPELINE_AFTER_AUDIO[idx + 1] as JobState;
    job.state = next;
    job.updated_at = now.toISOString();

    try {
      if (next === 'asr_complete') {
        job.transcript = await this.vendorFacade.resolveTranscript(job);
      } else if (next === 'moderation_passed') {
        const mod = await this.vendorFacade.moderateTranscript(job);
        if (!mod.ok) {
          this.markFailed(job, mod.reason_code);
          return;
        }
      } else if (next === 'image_generation') {
        const gen = await this.vendorFacade.runImageGeneration(job);
        if (!gen.ok) {
          this.markFailed(job, gen.reason_code);
          return;
        }
      } else if (next === 'preview_ready') {
        const p = await this.vendorFacade.finalizePreview(job, now.getTime());
        job.preview_url = p.url;
        job.preview_url_expires_at = p.expiresAtIso;
      }
    } catch {
      this.markFailed(job, 'PIPELINE_UPSTREAM_ERROR');
    }
  }

  private markFailed(job: JobRecord, code: string) {
    job.state = 'failed';
    job.error_code = code;
    job.updated_at = new Date().toISOString();
    delete job.pending_preview_image_url;
    delete job.pending_preview_image_base64;
  }

  private schedulePersist() {
    if (this.store.usesRedis()) return;
    if (!this.persistPath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersistenceSync(), 400);
  }

  private flushPersistenceSync() {
    if (this.store.usesRedis()) return;
    if (!this.persistPath) return;
    const snap = this.store.exportMemorySnapshot();
    const blob: PersistedJobsBlob = {
      v: 1,
      jobs: snap.jobs,
      createIdempotency: snap.createIdempotency,
      printAckIdempotency: snap.printAckIdempotency,
    };
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(blob), 'utf8');
    } catch {
      /* ignore */
    }
  }

  private assertDevice(job: JobRecord, deviceId: string) {
    if (job.device_id !== deviceId) {
      throw new ForbiddenException({
        code: 'JOB_DEVICE_MISMATCH',
        message: 'job_id does not belong to this device',
      });
    }
  }

  private async requireJob(jobId: string): Promise<JobRecord> {
    const job = await this.store.getJob(jobId);
    if (!job) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        message: `Unknown job_id: ${jobId}`,
      });
    }
    return job;
  }
}
