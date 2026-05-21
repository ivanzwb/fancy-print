import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JobRecord, JobState } from './job.types';
import { MqttService } from '../mqtt/mqtt.service';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

const PIPELINE_AFTER_AUDIO: JobState[] = [
  'audio_received',
  'asr_complete',
  'moderation_passed',
  'image_generation',
  'preview_ready',
];

@Injectable()
export class JobsService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly createIdempotency = new Map<string, string>();
  private readonly printAckIdempotency = new Map<
    string,
    { job_id: string; accepted_at: string }
  >();

  constructor(private readonly mqtt: MqttService) {}

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

    if (input.idempotencyKey) {
      const existingId = this.createIdempotency.get(input.idempotencyKey);
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
      this.createIdempotency.set(input.idempotencyKey, job.job_id);
    }
    this.mqtt.publishJobStatus(job);
    return { ...job };
  }

  /** One stub pipeline step per poll until preview_ready (doc §4.1). */
  getJob(jobId: string, deviceId: string): JobRecord {
    const job = this.getRef(jobId);
    this.assertDevice(job, deviceId);
    this.advanceStubPipeline(job);
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

  attachAudio(jobId: string, deviceId: string): JobRecord {
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
    job.state = 'audio_received';
    job.updated_at = new Date().toISOString();
    this.mqtt.publishJobStatus(job);
    return { ...job };
  }

  printAck(jobId: string, deviceId: string, idempotencyKey?: string) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for print-ack',
      });
    }
    const key = idempotencyKey.trim();
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

  private advanceStubPipeline(job: JobRecord): void {
    const idx = PIPELINE_AFTER_AUDIO.indexOf(job.state as JobState);
    if (idx === -1) return;
    if (idx >= PIPELINE_AFTER_AUDIO.length - 1) return;
    const now = new Date();
    job.state = PIPELINE_AFTER_AUDIO[idx + 1] as JobState;
    job.updated_at = now.toISOString();
    if (job.state === 'preview_ready') {
      const expires = new Date(now.getTime() + PREVIEW_TTL_MS);
      job.preview_url = `https://example.invalid/preview/${job.job_id}.png`;
      job.preview_url_expires_at = expires.toISOString();
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
