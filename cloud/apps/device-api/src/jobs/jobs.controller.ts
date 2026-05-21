import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentDevice } from '../common/current-device.decorator';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(
    @CurrentDevice() dev: { device_id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: { content_mode?: string; child_profile_id?: string },
  ) {
    return this.jobs.createJob({
      content_mode: body.content_mode ?? '',
      device_id: dev.device_id,
      idempotencyKey: idempotencyKey?.trim() || undefined,
      child_profile_id: body.child_profile_id,
    });
  }

  @Get(':jobId')
  getOne(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
  ) {
    return this.jobs.getJob(jobId, dev.device_id);
  }

  @Post(':jobId/audio')
  uploadAudio(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
  ) {
    return this.jobs.attachAudio(jobId, dev.device_id);
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
