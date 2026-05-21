import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JobRecord, JobState } from './job.types';
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

const MAX_AUDIO_B64_LEN = 400_000;

function capAudioBase64(s: string | undefined): string | undefined {
  if (s === undefined || typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > MAX_AUDIO_B64_LEN ? t.slice(0, MAX_AUDIO_B64_LEN) : t;
}

@Injectable()
export class JobsService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly createIdempotency = new Map<string, string>();
  private readonly printAckIdempotency = new Map<
    string,
    { job_id: string; accepted_at: string }
  >();

  constructor(
    private readonly mqtt: MqttService,
    private readonly policy: PolicyService,
    private readonly vendorFacade: VendorFacadeService,
  ) {}

  createJob(input: {
    content_mode: string;
    device_id: string;
    idempotencyKey?: string;
    child_profile_id?: string;
  }): JobRecord {
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

    if (input.idempotencyKey) {
      const idemKey = `${input.device_id}:${input.idempotencyKey}`;
      const existingId = this.createIdempotency.get(idemKey);
      if (existingId) {
        const job = this.jobs.get(existingId);
        if (job) {
          this.assertDevice(job, input.device_id);
          return { ...job };
        }
      }
    }

    const now = new Date().toISOString();
    const job: JobRecord = {
      job_id: randomUUID(),
      device_id: input.device_id,
      content_mode: mode,
      child_profile_id: input.child_profile_id?.trim() || undefined,
      state: 'created',
      policy_version: 1,
      created_at: now,
      updated_at: now,
    };
    this.jobs.set(job.job_id, job);
    if (input.idempotencyKey) {
      this.createIdempotency.set(
        `${input.device_id}:${input.idempotencyKey}`,
        job.job_id,
      );
    }
    this.mqtt.publishJobStatus(job);
    return { ...job };
  }

  /** One stub pipeline step per poll until preview_ready (doc §4.1). */
  async getJob(jobId: string, deviceId: string): Promise<JobRecord> {
    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);
    await this.advanceStubPipelineAsync(job);
    this.mqtt.publishJobStatus(job);
    return { ...job };
  }

  getArtifactRedirectUrl(jobId: string, deviceId: string): string | null {
    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);
    if (job.state !== 'preview_ready' && job.state !== 'print_acknowledged') {
      return null;
    }
    if (!job.preview_url) return null;
    return job.preview_url;
  }

  attachAudio(
    jobId: string,
    deviceId: string,
    audioBase64?: string,
  ): JobRecord {
    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);
    if (job.state === 'preview_ready' || job.state === 'print_acknowledged') {
      return { ...job };
    }
    if (job.state !== 'created') {
      throw new ConflictException({
        code: 'INVALID_JOB_STATE',
        message: `Cannot attach audio in state ${job.state}`,
      });
    }
    const capped = capAudioBase64(audioBase64);
    if (capped) job.audio_base64 = capped;
    delete job.chunks_max_seq;
    job.state = 'audio_received';
    job.updated_at = new Date().toISOString();
    this.mqtt.publishJobStatus(job);
    return { ...job };
  }

  /**
   * doc/4 §2.4.1 分片序号桩：无真实音频缓冲。
   * - 无 body / `{}`：与 `POST .../audio` 相同，直接关采音。
   * - `{ "final": true }`：同上。
   * - `{ "seq": n, "final": false|true }`：`seq` 须严格大于已接受的最大序号；`final:true` 时关采音。
   */
  uploadChunk(
    jobId: string,
    deviceId: string,
    body?: { seq?: number; final?: boolean },
  ): JobRecord {
    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);

    const raw = body ?? {};
    const keys = Object.keys(raw);
    const hasSeq = typeof raw.seq === 'number';
    const finalExplicit = 'final' in raw && typeof raw.final === 'boolean';

    if (keys.length === 0) {
      return this.attachAudio(jobId, deviceId);
    }

    if (!hasSeq && raw.final === true) {
      return this.attachAudio(jobId, deviceId);
    }

    if (!hasSeq && raw.final === false) {
      throw new BadRequestException({
        code: 'CHUNK_SEQ_REQUIRED',
        message: 'seq is required when final is false',
      });
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
        return { ...job };
      }
      job.chunks_max_seq = seq;
      job.updated_at = new Date().toISOString();
      if (raw.final) {
        delete job.chunks_max_seq;
        job.state = 'audio_received';
        job.updated_at = new Date().toISOString();
        this.mqtt.publishJobStatus(job);
        return { ...job };
      }
      this.mqtt.publishJobStatus(job);
      return { ...job };
    }

    return this.attachAudio(jobId, deviceId);
  }

  printAck(jobId: string, deviceId: string, idempotencyKey?: string) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for print-ack',
      });
    }
    const key = `${deviceId}:${idempotencyKey.trim()}`;
    const cached = this.printAckIdempotency.get(key);
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

    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);
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
    this.printAckIdempotency.set(key, { job_id: jobId, accepted_at: acceptedAt });
    this.mqtt.publishJobStatus(job);
    return {
      job_id: jobId,
      accepted: true,
      accepted_at: acceptedAt,
      idempotent_replay: false,
    };
  }

  private async advanceStubPipelineAsync(job: JobRecord): Promise<void> {
    const idx = PIPELINE_AFTER_AUDIO.indexOf(job.state as JobState);
    if (idx === -1) return;
    if (idx >= PIPELINE_AFTER_AUDIO.length - 1) return;
    const now = new Date();
    job.state = PIPELINE_AFTER_AUDIO[idx + 1] as JobState;
    job.updated_at = now.toISOString();
    if (job.state === 'asr_complete') {
      job.transcript = await this.vendorFacade.resolveTranscript(job);
    }
    if (job.state === 'preview_ready') {
      const p = await this.vendorFacade.resolvePreview(job, now.getTime());
      job.preview_url = p.url;
      job.preview_url_expires_at = p.expiresAtIso;
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

  private getRef(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        message: `Unknown job_id: ${jobId}`,
      });
    }
    return job;
  }
}
