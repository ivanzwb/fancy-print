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
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentDevice() dev: { device_id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: { content_mode?: string; child_profile_id?: string },
  ) {
    const job = this.jobs.createJob({
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
    return this.jobs.getJob(jobId, dev.device_id);
  }

  @Post(':jobId/audio')
  uploadAudio(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Body() body?: { audio_base64?: string },
  ) {
    return this.jobs.attachAudio(jobId, dev.device_id, body?.audio_base64);
  }

  @Post(':jobId/chunks')
  uploadChunks(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Body() body?: { seq?: number; final?: boolean },
  ) {
    return this.jobs.uploadChunk(jobId, dev.device_id, body);
  }

  @Post(':jobId/print-ack')
  printAck(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.jobs.printAck(jobId, dev.device_id, idempotencyKey);
  }
}
