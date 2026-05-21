import { Inject, Injectable } from '@nestjs/common';
import type { JobRecord } from '../jobs/job.types';
import { S3AudioStagingService } from './s3-audio-staging.service';
import { S3PreviewService } from './s3-preview.service';
import { VendorHttpService } from './vendor-http.service';
import { VendorStubsService } from './vendor-stubs.service';
import type { AsrAdapter } from './vendors/asr-adapter.interface';
import type { ImageGenAdapter } from './vendors/image-gen-adapter.interface';
import { ASR_ADAPTER, IMAGE_GEN_ADAPTER } from './vendors/vendor-adapters.tokens';

const DATA_URL_MAX = 120_000;

@Injectable()
export class VendorFacadeService {
  constructor(
    @Inject(ASR_ADAPTER) private readonly asr: AsrAdapter,
    @Inject(IMAGE_GEN_ADAPTER) private readonly imageGen: ImageGenAdapter,
    private readonly stub: VendorStubsService,
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

    const fromAdapter = await this.asr.transcribe({
      jobId: job.job_id,
      contentMode: job.content_mode,
      audioBase64,
      audioPresignedUrl: presigned ?? undefined,
    });
    if (fromAdapter) return fromAdapter;
    return this.stub.stubTranscript(job);
  }

  /** 文本审核：未配置 `MODERATION_TEXT_HTTP_URL` 时放行。 */
  async moderateTranscript(
    job: JobRecord,
  ): Promise<{ ok: true } | { ok: false; reason_code: string }> {
    const transcript =
      job.transcript ?? this.stub.stubTranscript(job);
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
    const transcript = job.transcript ?? this.stub.stubTranscript(job);

    try {
      const img = await this.imageGen.generate({
        jobId: job.job_id,
        contentMode: job.content_mode,
        transcript,
      });

      if (img?.imageUrl || img?.imageBase64) {
        try {
          const mod = await this.http.moderateImageViaHttp({
            jobId: job.job_id,
            imageUrl: img.imageUrl,
            imageBase64: img.imageBase64,
          });
          if (!mod.ok) return { ok: false, reason_code: mod.reason_code };
        } catch {
          return { ok: false, reason_code: 'IMAGE_MODERATION_UPSTREAM_ERROR' };
        }
        job.pending_preview_image_url = img.imageUrl;
        job.pending_preview_image_base64 = img.imageBase64;
        return { ok: true };
      }
    } catch {
      return { ok: false, reason_code: 'IMAGE_GEN_UPSTREAM_ERROR' };
    }

    const stub = this.stub.stubPreviewAsset(job.job_id, Date.now());
    job.pending_preview_image_url = stub.url;
    delete job.pending_preview_image_base64;
    return { ok: true };
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
      return { url: urlPending, expiresAtIso };
    }

    if (b64Pending) {
      const uploaded = await this.s3.uploadJobPreviewFromBase64(
        job.job_id,
        b64Pending,
      );
      if (uploaded) {
        const presign = await this.s3.presignPreviewIfConfigured(job, nowMs);
        if (presign) return presign;
      }
      const b64 = b64Pending.slice(0, DATA_URL_MAX);
      return {
        url: `data:image/png;base64,${b64}`,
        expiresAtIso,
      };
    }

    const s3 = await this.s3.presignPreviewIfConfigured(job, nowMs);
    if (s3) return s3;

    return this.stub.stubPreviewAsset(job.job_id, nowMs);
  }
}
