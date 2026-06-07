import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { JobRecord } from '../jobs/job.types';
import { S3AudioStagingService } from './s3-audio-staging.service';
import { S3PreviewService } from './s3-preview.service';
import { VendorHttpService } from './vendor-http.service';
import type { AsrAdapter } from './vendors/asr-adapter.interface';
import type { ImageGenAdapter } from './vendors/image-gen-adapter.interface';
import { ASR_ADAPTER, IMAGE_GEN_ADAPTER } from './vendors/vendor-adapters.tokens';

const DATA_URL_MAX = 5_000_000; // 足够容纳 1024×1024 PNG (~2.5MB base64)

@Injectable()
export class VendorFacadeService {
  private readonly logger = new Logger(VendorFacadeService.name);

  constructor(
    @Inject(ASR_ADAPTER) private readonly asr: AsrAdapter,
    @Inject(IMAGE_GEN_ADAPTER) private readonly imageGen: ImageGenAdapter,
    private readonly http: VendorHttpService,
    private readonly s3: S3PreviewService,
    private readonly audioStaging: S3AudioStagingService,
  ) {}

  async resolveTranscript(job: JobRecord): Promise<string> {
    const asrConfigured = this.asr.usesAudioStaging();
    let presigned: string | null = null;
    let audioBase64: string | undefined;

    // Priority: S3 key from early upload → inline base64 → legacy inline → stub
    if (asrConfigured && job.audio_s3_key && job.audio_s3_bucket) {
      presigned = await this.audioStaging.presignedGetUrlForKey(
        job.audio_s3_bucket,
        job.audio_s3_key,
      );
    } else if (asrConfigured && job.audio_base64?.trim()) {
      presigned = await this.audioStaging.presignedGetUrlForJobAudio(
        job.job_id,
        job.audio_base64.trim(),
      );
    }

    const sendB64WithPresigned =
      process.env.ASR_SEND_BASE64_WITH_PRESIGNED === '1' ||
      process.env.ASR_HTTP_SEND_BASE64_WITH_PRESIGNED === '1';
    if (!presigned || sendB64WithPresigned) {
      audioBase64 = job.audio_base64;
    }

    this.logger.log(
      `[ASR][job_id=${job.job_id}] START: content_mode=${job.content_mode}, ` +
      `audio_s3_key=${job.audio_s3_key ?? 'none'}, ` +
      `audio_base64_len=${job.audio_base64?.length ?? 0}, ` +
      `presigned_url=${presigned ? presigned.slice(0, 80) + '...' : 'none'}`,
    );

    const fromAdapter = await this.asr.transcribe({
      jobId: job.job_id,
      contentMode: job.content_mode,
      audioBase64,
      audioPresignedUrl: presigned ?? undefined,
    });

    this.logger.log(
      `[ASR][job_id=${job.job_id}] DONE: transcript=${fromAdapter ? `"${fromAdapter.slice(0, 80)}${fromAdapter.length > 80 ? '...' : ''}"` : 'null'}, ` +
      `adapter=${this.asr.constructor.name}`,
    );

    if (fromAdapter) return fromAdapter;
    throw new Error(`ASR returned no result for job_id=${job.job_id}, content_mode=${job.content_mode}`);
  }

  /** 文本审核：未配置 `MODERATION_TEXT_HTTP_URL` 时放行。 */
  async moderateTranscript(
    job: JobRecord,
  ): Promise<{ ok: true } | { ok: false; reason_code: string }> {
    const transcript =
      job.transcript ?? '';
    return this.http.moderateTextViaHttp({
      jobId: job.job_id,
      contentMode: job.content_mode,
      transcript,
    });
  }

  /**
   * 生图 +（可选）成图审核；结果写入 `pending_preview_*`，供下一档 `preview_ready` 定稿。
   * 未配置任何生图适配器（HTTP / 通义）时使用桩预览 URL（跳过成图审核 HTTP）。
   */
  async runImageGeneration(
    job: JobRecord,
  ): Promise<{ ok: true } | { ok: false; reason_code: string }> {
    const transcript = job.transcript ?? '';
    this.logger.log(
      `[IMG_GEN][job_id=${job.job_id}] START: content_mode=${job.content_mode}, ` +
      `transcript="${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`,
    );

    try {
      const img = await this.imageGen.generate({
        jobId: job.job_id,
        contentMode: job.content_mode,
        transcript,
      });

      if (img?.imageUrl || img?.imageBase64) {
        this.logger.log(
          `[IMG_GEN][job_id=${job.job_id}] IMAGE_GOT: ` +
          `image_url=${img.imageUrl ? img.imageUrl.slice(0, 80) + '...' : 'none'}, ` +
          `image_base64_len=${img.imageBase64?.length ?? 0}`,
        );
        try {
          const mod = await this.http.moderateImageViaHttp({
            jobId: job.job_id,
            imageUrl: img.imageUrl,
            imageBase64: img.imageBase64,
          });
          if (!mod.ok) {
            this.logger.warn(
              `[IMG_GEN][job_id=${job.job_id}] MODERATION_REJECTED: reason_code=${mod.reason_code}`,
            );
            return { ok: false, reason_code: mod.reason_code };
          }
        } catch {
          this.logger.error(
            `[IMG_GEN][job_id=${job.job_id}] MODERATION_ERROR: marking as upstream error`,
          );
          return { ok: false, reason_code: 'IMAGE_MODERATION_UPSTREAM_ERROR' };
        }
        job.pending_preview_image_url = img.imageUrl;
        job.pending_preview_image_base64 = img.imageBase64;
        this.logger.log(
          `[IMG_GEN][job_id=${job.job_id}] DONE: moderation passed, pending preview stored`,
        );
        return { ok: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[IMG_GEN][job_id=${job.job_id}] ERROR: ${msg}`,
      );
      return { ok: false, reason_code: 'IMAGE_GEN_UPSTREAM_ERROR' };
    }

    throw new Error(
      `Image generation returned no result for job_id=${job.job_id}, content_mode=${job.content_mode}`,
    );
  }

  /** 由 `pending_preview_*` 生成对外 `preview_url`（S3 上传 / 预签名 / data URL / 桩）。 */
  async finalizePreview(
    job: JobRecord,
    nowMs: number,
  ): Promise<{ url: string; expiresAtIso: string }> {
    const ttlMs = Math.min(
      Math.max(Number(process.env.IMAGE_GEN_URL_TTL_MS ?? 900_000), 60_000),
      24 * 3600 * 1000,
    );
    const expiresAtIso = new Date(nowMs + ttlMs).toISOString();

    const urlPending = job.pending_preview_image_url?.trim();
    const b64Pending = job.pending_preview_image_base64?.trim();

    delete job.pending_preview_image_url;
    delete job.pending_preview_image_base64;

    if (urlPending) {
      const isDashscopeOss =
        urlPending.includes('dashscope-') && urlPending.includes('.oss-') ||
        urlPending.includes('aliyuncs.com');
      if (isDashscopeOss) {
        this.logger.log(
          `[PREVIEW][job_id=${job.job_id}] DASHSCOPE_URL: downloading`,
        );
        try {
          const res = await fetch(urlPending, { signal: AbortSignal.timeout(30_000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const b64 = buf.toString('base64');
            if (this.s3.isConfigured()) {
              const uploaded = await this.s3.uploadJobPreviewFromBase64(job.job_id, b64);
              if (uploaded) {
                const presign = await this.s3.presignPreviewIfConfigured(job, nowMs);
                if (presign) {
                  this.logger.log(
                    `[PREVIEW][job_id=${job.job_id}] READY: source=dashscope→s3, ` +
                      `url=${presign.url.slice(0, 80)}..., expires_at=${presign.expiresAtIso}`,
                  );
                  return presign;
                }
              }
            }
            const dataUrl = `data:image/png;base64,${b64.slice(0, DATA_URL_MAX)}`;
            this.logger.log(
              `[PREVIEW][job_id=${job.job_id}] READY: source=dashscope→data_url, ` +
                `b64_len=${b64.length}, expires_at=${expiresAtIso}`,
            );
            return { url: dataUrl, expiresAtIso };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(
            `[PREVIEW][job_id=${job.job_id}] DASHSCOPE_DOWNLOAD_FAILED: ${msg}`,
          );
        }
      }
      this.logger.log(
        `[PREVIEW][job_id=${job.job_id}] READY: source=url, ` +
          `url=${urlPending.slice(0, 80)}..., expires_at=${expiresAtIso}`,
      );
      return { url: urlPending, expiresAtIso };
    }

    if (b64Pending) {
      this.logger.log(
        `[PREVIEW][job_id=${job.job_id}] READY: source=base64, ` +
        `b64_len=${b64Pending.length}, expires_at=${expiresAtIso}`,
      );
      const uploaded = await this.s3.uploadJobPreviewFromBase64(
        job.job_id,
        b64Pending,
      );
      if (uploaded) {
        const presign = await this.s3.presignPreviewIfConfigured(job, nowMs);
        if (presign) {
          this.logger.log(
            `[PREVIEW][job_id=${job.job_id}] READY: source=s3_presign, ` +
            `url=${presign.url.slice(0, 80)}..., expires_at=${presign.expiresAtIso}`,
          );
          return presign;
        }
      }
      const b64 = b64Pending.slice(0, DATA_URL_MAX);
      this.logger.log(
        `[PREVIEW][job_id=${job.job_id}] READY: source=data_url, ` +
        `b64_len=${b64.length}, expires_at=${expiresAtIso}`,
      );
      return {
        url: `data:image/png;base64,${b64}`,
        expiresAtIso,
      };
    }

    const s3 = await this.s3.presignPreviewIfConfigured(job, nowMs);
    if (s3) {
      this.logger.log(
        `[PREVIEW][job_id=${job.job_id}] READY: source=s3_fallback, ` +
        `url=${s3.url.slice(0, 80)}..., expires_at=${s3.expiresAtIso}`,
      );
      return s3;
    }

    throw new Error(
      `No preview URL available for job_id=${job.job_id} - image gen returned no result`,
    );
  }
}
