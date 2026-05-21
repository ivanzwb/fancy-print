import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * 可选 HTTP 集成：**文本 / 图像审核**（`MODERATION_*_HTTP_URL`），固定 JSON 契约。
 * ASR 与文生图已迁至进程内 **`AsrAdapter` / `ImageGenAdapter`**（见 `adapters/vendors/`；说明见仓库根目录 **`doc/4. 服务器端设计.md` §2.2.2**）。
 */
@Injectable()
export class VendorHttpService {
  private readonly logger = new Logger(VendorHttpService.name);

  /**
   * 文本审核：POST `{ job_id, content_mode, transcript }` → JSON
   * `{ allowed: true }` 或 `{ allowed: false, reason_code }`（亦接受 `blocked`/`code`）。
   */
  async moderateTextViaHttp(input: {
    jobId: string;
    contentMode: string;
    transcript: string;
  }): Promise<{ ok: true } | { ok: false; reason_code: string }> {
    const url = process.env.MODERATION_TEXT_HTTP_URL?.trim();
    if (!url) return { ok: true };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const auth = process.env.MODERATION_TEXT_HTTP_AUTHORIZATION?.trim();
    if (auth) headers.Authorization = auth;

    const timeoutMs = Math.min(
      Math.max(Number(process.env.MODERATION_TEXT_HTTP_TIMEOUT_MS ?? 30_000), 1000),
      120_000,
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
      this.logger.warn(`MODERATION_TEXT_HTTP fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'MODERATION_TEXT_HTTP_UNAVAILABLE',
        message: `Text moderation upstream unreachable: ${msg}`,
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'MODERATION_TEXT_HTTP_ERROR',
        message: `Text moderation HTTP ${res.status}: ${body.slice(0, 500)}`,
      });
    }

    const j = (await res.json()) as {
      allowed?: boolean;
      blocked?: boolean;
      reason_code?: string;
      code?: string;
    };
    const blocked =
      j.blocked === true ||
      j.allowed === false ||
      (typeof j.allowed === 'boolean' && !j.allowed);
    if (blocked) {
      const code =
        (typeof j.reason_code === 'string' && j.reason_code.trim()) ||
        (typeof j.code === 'string' && j.code.trim()) ||
        'MODERATION_REJECTED';
      return { ok: false, reason_code: code };
    }
    return { ok: true };
  }

  /**
   * 成图审核：POST `{ job_id, image_url?, image_base64? }`；未配置 URL 时由上层跳过。
   */
  async moderateImageViaHttp(input: {
    jobId: string;
    imageUrl?: string;
    imageBase64?: string;
  }): Promise<{ ok: true } | { ok: false; reason_code: string }> {
    const url = process.env.MODERATION_IMAGE_HTTP_URL?.trim();
    if (!url) return { ok: true };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const auth = process.env.MODERATION_IMAGE_HTTP_AUTHORIZATION?.trim();
    if (auth) headers.Authorization = auth;

    const timeoutMs = Math.min(
      Math.max(Number(process.env.MODERATION_IMAGE_HTTP_TIMEOUT_MS ?? 45_000), 1000),
      180_000,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          job_id: input.jobId,
          image_url: input.imageUrl ?? null,
          image_base64: input.imageBase64 ?? null,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`MODERATION_IMAGE_HTTP fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'MODERATION_IMAGE_HTTP_UNAVAILABLE',
        message: `Image moderation upstream unreachable: ${msg}`,
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'MODERATION_IMAGE_HTTP_ERROR',
        message: `Image moderation HTTP ${res.status}: ${body.slice(0, 500)}`,
      });
    }

    const j = (await res.json()) as {
      allowed?: boolean;
      blocked?: boolean;
      reason_code?: string;
      code?: string;
    };
    const blocked =
      j.blocked === true ||
      j.allowed === false ||
      (typeof j.allowed === 'boolean' && !j.allowed);
    if (blocked) {
      const code =
        (typeof j.reason_code === 'string' && j.reason_code.trim()) ||
        (typeof j.code === 'string' && j.code.trim()) ||
        'IMAGE_MODERATION_REJECTED';
      return { ok: false, reason_code: code };
    }
    return { ok: true };
  }
}
