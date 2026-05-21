import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

// ---------------------------------------------------------------------------
// Transient-error retry — exponential backoff with jitter
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Default retry config — overridable via env. */
function retryConfig(): { maxRetries: number; baseMs: number; maxMs: number } {
  return {
    maxRetries: Math.min(
      Math.max(Number(process.env.MODERATION_HTTP_MAX_RETRIES ?? 2), 0),
      10,
    ),
    baseMs: Math.min(
      Math.max(Number(process.env.MODERATION_HTTP_RETRY_BASE_MS ?? 200), 50),
      10_000,
    ),
    maxMs: Math.min(
      Math.max(Number(process.env.MODERATION_HTTP_RETRY_MAX_MS ?? 2000), 100),
      30_000,
    ),
  };
}

/** True for errors that are safe to retry (transient). */
function isRetryableHttpError(status: number): boolean {
  // 429 (rate-limit) is transient — retry after backoff.
  if (status === 429) return true;
  // 4xx business rejections MUST NOT be retried — the payload is stable.
  if (status >= 400 && status < 500) return false;
  // 5xx and anything else — try again.
  return true;
}

/**
 * Wrapper around `fetch()` that retries on transient failures with
 * exponential backoff + jitter.
 *
 * Retryable conditions:
 * - Network / DNS / timeout errors (fetch throws)
 * - HTTP 429 (rate-limit) / 5xx (server error)
 *
 * NOT retried:
 * - HTTP 4xx (client error — indicates business rejection or misconfiguration)
 *
 * The caller receives only the last error if all retries are exhausted.
 */
export async function retryFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const cfg = retryConfig();
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);

      // Transient server error — retry
      if (!res.ok && isRetryableHttpError(res.status) && attempt < cfg.maxRetries) {
        lastErr = new Error(`HTTP ${res.status}`);
        const delay = computeBackoff(attempt, cfg.baseMs, cfg.maxMs);
        await sleep(delay);
        continue;
      }

      // Non-retryable error (4xx) or last attempt succeeded via non-2xx pass-through
      if (!res.ok && attempt >= cfg.maxRetries) {
        lastErr = new Error(`HTTP ${res.status}`);
        break;
      }

      return res;
    } catch (e) {
      // Network / DNS / timeout — retry
      if (attempt < cfg.maxRetries) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const delay = computeBackoff(attempt, cfg.baseMs, cfg.maxMs);
        await sleep(delay);
        continue;
      }
      throw e; // Re-throw on last attempt
    }
  }

  // All attempts exhausted
  throw lastErr ?? new Error(`${label}: all retries exhausted`);
}

function computeBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const exp = baseMs * 2 ** attempt;
  const capped = Math.min(exp, maxMs);
  // Jitter: ±25 %
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

// ---------------------------------------------------------------------------

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
      res = await retryFetch(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            job_id: input.jobId,
            content_mode: input.contentMode,
            transcript: input.transcript,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        },
        'MODERATION_TEXT_HTTP',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`MODERATION_TEXT_HTTP failed after retries: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'MODERATION_TEXT_HTTP_UNAVAILABLE',
        message: `Text moderation upstream unreachable: ${msg}`,
      });
    }

    if (!res.ok) {
      // 4xx here means the upstream rejected the request (not transient)
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
      res = await retryFetch(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            job_id: input.jobId,
            image_url: input.imageUrl ?? null,
            image_base64: input.imageBase64 ?? null,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        },
        'MODERATION_IMAGE_HTTP',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`MODERATION_IMAGE_HTTP failed after retries: ${msg}`);
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
