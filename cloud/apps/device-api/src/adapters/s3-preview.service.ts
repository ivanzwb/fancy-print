import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { JobRecord } from '../jobs/job.types';

const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;

/**
 * S3 预签名 GET；可选 `S3_PREVIEW_UPLOAD=1` 时将生图 base64 以 PNG 写入同一 key 再签名。
 * 需：`S3_PREVIEW_BUCKET`、`AWS_REGION`、以及默认凭证链。
 */
@Injectable()
export class S3PreviewService {
  private readonly logger = new Logger(S3PreviewService.name);

  previewObjectKey(jobId: string): { bucket: string; region: string; key: string } | null {
    const bucket = process.env.S3_PREVIEW_BUCKET?.trim();
    const region = process.env.AWS_REGION?.trim();
    if (!bucket || !region) return null;
    const prefix = process.env.S3_PREVIEW_KEY_PREFIX?.trim() ?? 'previews/';
    const key = `${prefix}${jobId}.png`;
    return { bucket, region, key };
  }

  /** 将 PNG base64 写入 `previews/{job_id}.png`（需 `S3_PREVIEW_UPLOAD=1`）。 */
  async uploadJobPreviewFromBase64(
    jobId: string,
    base64: string,
  ): Promise<boolean> {
    const want = ['1', 'true', 'yes'].includes(
      (process.env.S3_PREVIEW_UPLOAD ?? '').toLowerCase(),
    );
    if (!want) return false;

    const loc = this.previewObjectKey(jobId);
    if (!loc) return false;

    let body: Buffer;
    try {
      body = Buffer.from(base64, 'base64');
    } catch {
      this.logger.warn('S3 preview upload: invalid base64');
      return false;
    }
    if (!body.length || body.length > MAX_PREVIEW_BYTES) {
      this.logger.warn(`S3 preview upload: size ${body.length} out of bounds`);
      return false;
    }

    try {
      const client = new S3Client({ region: loc.region });
      await client.send(
        new PutObjectCommand({
          Bucket: loc.bucket,
          Key: loc.key,
          Body: body,
          ContentType: 'image/png',
        }),
      );
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`S3 PutObject preview failed: ${msg}`);
      return false;
    }
  }

  async presignPreviewIfConfigured(
    job: Pick<JobRecord, 'job_id'>,
    nowMs: number,
  ): Promise<{ url: string; expiresAtIso: string } | null> {
    const loc = this.previewObjectKey(job.job_id);
    if (!loc) return null;

    const ttlSec = Math.min(
      Math.max(Number(process.env.S3_PREVIEW_TTL_SEC ?? 900), 60),
      24 * 3600,
    );

    try {
      const client = new S3Client({ region: loc.region });
      const cmd = new GetObjectCommand({ Bucket: loc.bucket, Key: loc.key });
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
