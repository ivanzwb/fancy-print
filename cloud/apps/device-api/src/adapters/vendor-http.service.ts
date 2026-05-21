import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * 可选 HTTP 集成：ASR / 文生图（自定义 URL + JSON 契约，便于接任意供应商或自建 BFF）。
 *
 * ASR：POST JSON `{ job_id, content_mode, audio_base64? }` → 响应 JSON `{ transcript }` 或 `{ text }`，或 `text/plain`。
 * 生图：POST JSON `{ job_id, content_mode, transcript }` → `{ image_url }` 或 `{ image_base64 }`。
 */
@Injectable()
export class VendorHttpService {
  private readonly logger = new Logger(VendorHttpService.name);

  async transcribeViaHttp(input: {
    jobId: string;
    contentMode: string;
    audioBase64?: string;
  }): Promise<string | null> {
    const url = process.env.ASR_HTTP_URL?.trim();
    if (!url) return null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain;q=0.9,*/*;q=0.1',
    };
    const auth = process.env.ASR_HTTP_AUTHORIZATION?.trim();
    if (auth) headers.Authorization = auth;

    const timeoutMs = Math.min(
      Math.max(Number(process.env.ASR_HTTP_TIMEOUT_MS ?? 60_000), 1000),
      300_000,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          job_id: input.jobId,
          content_mode: input.contentMode,
          audio_base64: input.audioBase64 ?? null,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ASR_HTTP fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'ASR_HTTP_UNAVAILABLE',
        message: `ASR upstream unreachable: ${msg}`,
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'ASR_HTTP_ERROR',
        message: `ASR HTTP ${res.status}: ${body.slice(0, 500)}`,
      });
    }

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = (await res.json()) as { transcript?: string; text?: string };
      const t = j.transcript ?? j.text;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
    const text = (await res.text()).trim();
    return text || null;
  }

  async imageGenViaHttp(input: {
    jobId: string;
    contentMode: string;
    transcript: string;
  }): Promise<{ imageUrl?: string; imageBase64?: string } | null> {
    const url = process.env.IMAGE_GEN_HTTP_URL?.trim();
    if (!url) return null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const auth = process.env.IMAGE_GEN_HTTP_AUTHORIZATION?.trim();
    if (auth) headers.Authorization = auth;

    const timeoutMs = Math.min(
      Math.max(Number(process.env.IMAGE_GEN_HTTP_TIMEOUT_MS ?? 120_000), 1000),
      600_000,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          job_id: input.jobId,
          content_mode: input.contentMode,
          transcript: input.transcript,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`IMAGE_GEN_HTTP fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'IMAGE_GEN_HTTP_UNAVAILABLE',
        message: `Image-gen upstream unreachable: ${msg}`,
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'IMAGE_GEN_HTTP_ERROR',
        message: `Image-gen HTTP ${res.status}: ${body.slice(0, 500)}`,
      });
    }

    const j = (await res.json()) as {
      image_url?: string;
      image_base64?: string;
    };
    const imageUrl =
      typeof j.image_url === 'string' && j.image_url.trim()
        ? j.image_url.trim()
        : undefined;
    const imageBase64 =
      typeof j.image_base64 === 'string' && j.image_base64.trim()
        ? j.image_base64.trim()
        : undefined;
    if (!imageUrl && !imageBase64) return null;
    return { imageUrl, imageBase64 };
  }
}
