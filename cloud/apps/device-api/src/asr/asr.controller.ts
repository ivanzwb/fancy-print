import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { ASR_ADAPTER } from '../adapters/vendors/vendor-adapters.tokens';
import type { AsrAdapter } from '../adapters/vendors/asr-adapter.interface';
import { JobsService } from '../jobs/jobs.service';
import { randomUUID } from 'node:crypto';

@Controller('asr')
export class AsrController {
  private readonly logger = new Logger(AsrController.name);

  constructor(
    @Inject(ASR_ADAPTER) private readonly asr: AsrAdapter,
    private readonly jobs: JobsService,
  ) {}

  @Public()
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  async transcribe(
    @Body() body: { audio_base64: string; content_mode?: string },
    @Headers('x-device-id') deviceId?: string,
  ) {
    const audioBase64 = body.audio_base64?.trim();
    if (!audioBase64) {
      return { text: '' };
    }

    const result = await this.asr.transcribe({
      jobId: `asr-${randomUUID().slice(0, 8)}`,
      contentMode: body.content_mode ?? 'default',
      audioBase64,
    });

    if (!result) {
      this.logger.warn(`ASR returned no result for device=${deviceId?.trim() || 'unknown'}`);
      return { text: '', error: 'asr_no_result' };
    }

    const devId = deviceId?.trim() || 'device-unknown';
    try {
      const job = await this.jobs.createJobFromTranscript({
        content_mode: body.content_mode || 'coloring',
        device_id: devId,
        transcript: result,
      });
      this.logger.log(
        `ASR -> job ${job.job_id} created, state=${job.state}, text="${result}"`,
      );
      return { text: result, job_id: job.job_id, state: job.state };
    } catch (e) {
      this.logger.warn(
        `Failed to create job from ASR transcript: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { text: result };
    }
  }
}
