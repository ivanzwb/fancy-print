import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { JobRecord } from '../jobs/job.types';

/**
 * S3 预签名 GET（GCS 请用单独 workload / 或在上游 HTTP 生图服务内签名后回 `image_url`）。
 * 需：`S3_PREVIEW_BUCKET`、`AWS_REGION`、以及默认凭证链（如 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 或实例角色）。
 */
@Injectable()
export class S3PreviewService {
  private readonly logger = new Logger(S3PreviewService.name);

  async presignPreviewIfConfigured(
    job: Pick<JobRecord, 'job_id'>,
    nowMs: number,
  ): Promise<{ url: string; expiresAtIso: string } | null> {
    const bucket = process.env.S3_PREVIEW_BUCKET?.trim();
    const region = process.env.AWS_REGION?.trim();
    if (!bucket || !region) return null;

    const prefix = process.env.S3_PREVIEW_KEY_PREFIX?.trim() ?? 'previews/';
    const key = `${prefix}${job.job_id}.png`;
    const ttlSec = Math.min(
      Math.max(Number(process.env.S3_PREVIEW_TTL_SEC ?? 900), 60),
      24 * 3600,
    );

    try {
      const client = new S3Client({ region });
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(client, cmd, { expiresIn: ttlSec });
      const expiresAtIso = new Date(nowMs + ttlSec * 1000).toISOString();
      return { url, expiresAtIso };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`S3 presign failed: ${msg}`);
      return null;
    }
  }
}
