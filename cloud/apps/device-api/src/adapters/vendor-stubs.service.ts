import { Injectable } from '@nestjs/common';
import type { JobRecord } from '../jobs/job.types';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

/**
 * 量产时替换为：ASR Adapter、Image Gen Adapter、Object Storage（签名 URL）等。
 * 当前为内存桩，便于编排与契约联调（见 doc/4 §8.1）。
 */
@Injectable()
export class VendorStubsService {
  /** 接真实 ASR 后：用供应商返回的脱敏 transcript 替换。 */
  stubTranscript(job: Pick<JobRecord, 'content_mode'>): string {
    return `[stub asr] ${job.content_mode}`;
  }

  /** 接对象存储 + CDN 后：返回短 TTL 的 HTTPS 签名 URL。 */
  stubPreviewAsset(jobId: string, nowMs: number): { url: string; expiresAtIso: string } {
    const expires = new Date(nowMs + PREVIEW_TTL_MS);
    return {
      url: `https://example.invalid/preview/${jobId}.png`,
      expiresAtIso: expires.toISOString(),
    };
  }
}
