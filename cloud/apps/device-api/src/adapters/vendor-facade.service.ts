import { Injectable } from '@nestjs/common';
import type { JobRecord } from '../jobs/job.types';
import { S3PreviewService } from './s3-preview.service';
import { VendorHttpService } from './vendor-http.service';
import { VendorStubsService } from './vendor-stubs.service';

const DATA_URL_MAX = 120_000;

@Injectable()
export class VendorFacadeService {
  constructor(
    private readonly stub: VendorStubsService,
    private readonly http: VendorHttpService,
    private readonly s3: S3PreviewService,
  ) {}

  async resolveTranscript(job: JobRecord): Promise<string> {
    const fromHttp = await this.http.transcribeViaHttp({
      jobId: job.job_id,
      contentMode: job.content_mode,
      audioBase64: job.audio_base64,
    });
    if (fromHttp) return fromHttp;
    return this.stub.stubTranscript(job);
  }

  async resolvePreview(job: JobRecord, nowMs: number): Promise<{
    url: string;
    expiresAtIso: string;
  }> {
    const transcript = job.transcript ?? this.stub.stubTranscript(job);

    const img = await this.http.imageGenViaHttp({
      jobId: job.job_id,
      contentMode: job.content_mode,
      transcript,
    });

    if (img?.imageUrl) {
      const ttlMs = Math.min(
        Math.max(Number(process.env.IMAGE_GEN_URL_TTL_MS ?? 900_000), 60_000),
        24 * 3600 * 1000,
      );
      return {
        url: img.imageUrl,
        expiresAtIso: new Date(nowMs + ttlMs).toISOString(),
      };
    }

    if (img?.imageBase64) {
      const b64 = img.imageBase64.slice(0, DATA_URL_MAX);
      const ttlMs = Math.min(
        Math.max(Number(process.env.IMAGE_GEN_URL_TTL_MS ?? 900_000), 60_000),
        24 * 3600 * 1000,
      );
      return {
        url: `data:image/png;base64,${b64}`,
        expiresAtIso: new Date(nowMs + ttlMs).toISOString(),
      };
    }

    const s3 = await this.s3.presignPreviewIfConfigured(job, nowMs);
    if (s3) return s3;

    return this.stub.stubPreviewAsset(job.job_id, nowMs);
  }
}
