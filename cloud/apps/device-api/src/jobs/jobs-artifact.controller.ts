import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentDevice } from '../common/current-device.decorator';
import { JobsService } from './jobs.service';

/** Doc §2.4.1: `GET /v1/jobs/{job_id}/artifact` — 302 to preview URL when ready. */
@Controller('jobs')
export class JobsArtifactController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':jobId/artifact')
  async artifact(
    @Param('jobId') jobId: string,
    @CurrentDevice() dev: { device_id: string },
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const url = await this.jobs.getArtifactRedirectUrl(jobId, dev.device_id);
    if (!url) {
      void reply.status(409).send({
        code: 'ARTIFACT_NOT_READY',
        message:
          'Preview URL not available yet; poll GET /v1/jobs/{job_id} until state is preview_ready',
      });
      return;
    }
    void reply.redirect(url);
  }
}
