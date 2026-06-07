import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentDevice } from '../common/current-device.decorator';
import { Public } from '../common/public.decorator';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentDevice() dev: { device_id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: { content_mode?: string; child_profile_id?: string },
  ) {
    const job = await this.jobs.createJob({
      content_mode: body.content_mode ?? '',
      device_id: dev.device_id,
      idempotencyKey: idempotencyKey?.trim() || undefined,
      child_profile_id: body.child_profile_id,
    });
    reply.header('Location', `/v1/jobs/${job.job_id}`);
    return job;
  }

  @Get(':jobId')
  async getOne(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
  ) {
    // Pure read — no pipeline side effect (moved to POST .../advance)
    return await this.jobs.getJob(jobId, dev.device_id);
  }

  /** Public status endpoint for device polling — uses x-device-id instead of JWT. */
  @Public()
  @Get(':jobId/status')
  async getJobStatus(
    @Param('jobId') jobId: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const devId = deviceId?.trim() || 'device-unknown';
    const job = await this.jobs.getJob(jobId, devId);
    return {
      job_id: job.job_id,
      state: job.state,
      transcript: job.transcript,
      preview_url: job.preview_url,
      preview_url_expires_at: job.preview_url_expires_at,
      error_code: job.error_code,
      content_mode: job.content_mode,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };
  }

  /** Public advance endpoint for device polling — uses x-device-id instead of JWT. */
  @Public()
  @Post(':jobId/advance')
  @HttpCode(HttpStatus.OK)
  async advance(
    @Param('jobId') jobId: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const devId = deviceId?.trim() || 'device-unknown';
    return await this.jobs.advanceJob(jobId, devId);
  }

  @Post(':jobId/audio')
  async uploadAudio(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Body() body?: { audio_base64?: string },
  ) {
    return await this.jobs.attachAudio(jobId, dev.device_id, body?.audio_base64);
  }

  /** 提交已识别的文字（跳过云端 ASR，直接推进到生图管道） */
  @Post(':jobId/text')
  async attachText(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Body() body?: { transcript?: string },
  ) {
    return await this.jobs.attachText(jobId, dev.device_id, body?.transcript);
  }

  @Post(':jobId/chunks')
  async uploadChunks(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Body() body?: { seq?: number; final?: boolean; audio_base64?: string },
  ) {
    return await this.jobs.uploadChunk(jobId, dev.device_id, body);
  }

  @Post(':jobId/print-ack')
  async printAck(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return await this.jobs.printAck(jobId, dev.device_id, idempotencyKey);
  }
}
