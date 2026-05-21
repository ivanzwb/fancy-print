import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/**
 * 将 Job 音频写入 **`S3_AUDIO_BUCKET`** 并生成短期 **GET 预签名 URL**，供 ASR HTTP 服务拉取（避免超大 JSON body）。
 * 与预览桶可分离；共用 **`AWS_REGION`** 与凭证链。
 */
@Injectable()
export class S3AudioStagingService {
  private readonly logger = new Logger(S3AudioStagingService.name);

  /**
   * 上传后返回预签名 GET URL；未配置桶或失败时返回 `null`。
   */
  async presignedGetUrlForJobAudio(
    jobId: string,
    audioBase64: string,
  ): Promise<string | null> {
    const bucket = process.env.S3_AUDIO_BUCKET?.trim();
    const region = process.env.AWS_REGION?.trim();
    if (!bucket || !region) return null;

    let body: Buffer;
    try {
      body = Buffer.from(audioBase64, 'base64');
    } catch {
      return null;
    }
    if (!body.length || body.length > MAX_AUDIO_BYTES) {
      this.logger.warn(`S3 audio staging: size ${body.length} out of bounds`);
      return null;
    }

    const prefix = process.env.S3_AUDIO_KEY_PREFIX?.trim() ?? 'audio-jobs/';
    const suffix = process.env.S3_AUDIO_SUFFIX?.trim() || '.bin';
    const key = `${prefix}${jobId}${suffix}`;
    const contentType =
      process.env.S3_AUDIO_CONTENT_TYPE?.trim() || 'application/octet-stream';
    const ttlSec = Math.min(
      Math.max(Number(process.env.S3_AUDIO_GET_TTL_SEC ?? 900), 60),
      3600,
    );

    try {
      const client = new S3Client({ region });
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      return await getSignedUrl(client, cmd, { expiresIn: ttlSec });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`S3 audio staging failed: ${msg}`);
      return null;
    }
  }
}
