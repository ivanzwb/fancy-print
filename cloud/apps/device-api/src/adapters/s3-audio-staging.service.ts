import { Injectable, Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Decoded audio payloads above this size are rejected. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export interface StagingResult {
  bucket: string;
  key: string;
  /** Short-lived presigned GET URL (downstream ASR pulls from this). */
  presignedUrl: string;
}

/**
 * 将 Job 音频写入 **`S3_AUDIO_BUCKET`** 并生成短期 **GET 预签名 URL**。
 *
 * 职责分两层：
 * 1. `stageAudio` — 接收 base64，直接上传 S3，返回 `StagingResult`（含 key）。
 *    调用方（`JobsService`）将 `audio_s3_key` 存入 JobRecord，不再保留 base64。
 * 2. `presignedGetUrlForKey` — 对已入库的 S3 key 签发预签名 URL（ASR 拉取用）。
 *
 * 共用 **`AWS_REGION`** 与凭证链。
 */
@Injectable()
export class S3AudioStagingService {
  private readonly logger = new Logger(S3AudioStagingService.name);

  /** 环境变量层面是否有可能启用 S3（bucket + region 均已设）。 */
  isConfigured(): boolean {
    return Boolean(
      process.env.S3_AUDIO_BUCKET?.trim() &&
        process.env.AWS_REGION?.trim(),
    );
  }

  private buildKey(jobId: string): string {
    const prefix = process.env.S3_AUDIO_KEY_PREFIX?.trim() ?? 'audio-jobs/';
    const suffix = process.env.S3_AUDIO_SUFFIX?.trim() || '.bin';
    return `${prefix}${jobId}${suffix}`;
  }

  /**
   * 将音频 base64 上传至 S3 并返回 key + 预签名 GET URL。
   * 解码后的字节超出 `MAX_AUDIO_BYTES` 或 S3 不可用时返回 `null`（调用方可降级）。
   */
  async stageAudio(
    jobId: string,
    audioBase64: string,
  ): Promise<StagingResult | null> {
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
      this.logger.warn(
        `S3 audio staging: decoded ${body.length} bytes exceeds limit`,
      );
      return null;
    }

    const key = this.buildKey(jobId);
    const contentType =
      process.env.S3_AUDIO_CONTENT_TYPE?.trim() ||
      'application/octet-stream';
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
      const presignedUrl = await getSignedUrl(client, cmd, {
        expiresIn: ttlSec,
      });
      return { bucket, key: key, presignedUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`S3 audio staging failed for job ${jobId}: ${msg}`);
      return null;
    }
  }

  /**
   * 对已有的 S3 key 签发 GET 预签名 URL（audio 已在先前 upload 过）。
   */
  async presignedGetUrlForKey(
    bucket: string,
    key: string,
  ): Promise<string | null> {
    const region = process.env.AWS_REGION?.trim();
    if (!region) return null;

    const ttlSec = Math.min(
      Math.max(Number(process.env.S3_AUDIO_GET_TTL_SEC ?? 900), 60),
      3600,
    );

    try {
      const client = new S3Client({ region });
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      return await getSignedUrl(client, cmd, { expiresIn: ttlSec });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `S3 presign failed for ${bucket}/${key}: ${msg}`,
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  //  Legacy — kept for backward compatibility (inline base64 → S3 → presigned)
  // ---------------------------------------------------------------------------
  async presignedGetUrlForJobAudio(
    jobId: string,
    audioBase64: string,
  ): Promise<string | null> {
    const result = await this.stageAudio(jobId, audioBase64);
    return result?.presignedUrl ?? null;
  }
}
