import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';
import { retryFetch } from '../vendor-http.service';
import { resolveImageSize } from './image-size.utils';

// ---------------------------------------------------------------------------
// Baidu Wenxin Yige (文心一格) — AI 作画-iRAG版
//
// Submit text → poll async task → return image URL.
// Shares the same OAuth 2.0 token endpoint as the Baidu ASR adapter.
//
// Auth: BAIDU_IMAGE_GEN_API_KEY / BAIDU_IMAGE_GEN_SECRET_KEY
//   Falls back to BAIDU_ASR_API_KEY / BAIDU_ASR_SECRET_KEY when image-gen
//   specific env vars are not set.
//
// API docs: https://cloud.baidu.com/doc/NLP/s/Im736qw1k
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const SUBMIT_URL = 'https://aip.baidubce.com/rpc/2.0/wenxin/v1/irag/textToImage';
const QUERY_URL = 'https://aip.baidubce.com/rpc/2.0/wenxin/v1/irag/getImg';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 300; // 10 min with 2s interval

@Injectable()
export class BaiduWenxinImageGenAdapter implements ImageGenAdapter {
  private readonly logger = new Logger(BaiduWenxinImageGenAdapter.name);

  private cachedToken: { value: string; expiresAt: number } | null = null;

  // ------------------------------------------------------------------
  // Credentials: image-gen specific → ASR credentials as fallback
  // ------------------------------------------------------------------

  private get apiKey(): string | undefined {
    return (
      process.env.BAIDU_IMAGE_GEN_API_KEY?.trim() ||
      process.env.BAIDU_ASR_API_KEY?.trim()
    );
  }

  private get secretKey(): string | undefined {
    return (
      process.env.BAIDU_IMAGE_GEN_SECRET_KEY?.trim() ||
      process.env.BAIDU_ASR_SECRET_KEY?.trim()
    );
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.secretKey);
  }

  // ------------------------------------------------------------------
  // OAuth 2.0 — same endpoint as Baidu ASR
  // ------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    const cached = this.cachedToken;
    if (cached && Date.now() < cached.expiresAt - 60_000) {
      return cached.value;
    }

    const apiKey = this.apiKey;
    const secretKey = this.secretKey;
    if (!apiKey || !secretKey) {
      throw new ServiceUnavailableException({
        code: 'BAIDU_IMAGE_GEN_NOT_CONFIGURED',
        message:
          'BAIDU_IMAGE_GEN_API_KEY / BAIDU_IMAGE_GEN_SECRET_KEY not set (or BAIDU_ASR_API_KEY / BAIDU_ASR_SECRET_KEY fallback)',
      });
    }

    const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException({
        code: 'BAIDU_IMAGE_GEN_TOKEN_UNAVAILABLE',
        message: msg,
      });
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'BAIDU_IMAGE_GEN_TOKEN_ERROR',
        message: `Token ${res.status}: ${t.slice(0, 200)}`,
      });
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    const token = data.access_token?.trim();
    if (!token) {
      throw new BadGatewayException({
        code: 'BAIDU_IMAGE_GEN_TOKEN_REJECTED',
        message: data.error ?? 'no access_token in response',
      });
    }

    const expiresIn = data.expires_in ?? 2592000;
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.logger.log(
      `Baidu Wenxin image gen token obtained, expires in ${expiresIn}s`,
    );

    return token;
  }

  // ------------------------------------------------------------------
  // Image generation via IRAG API (async submit + poll)
  // ------------------------------------------------------------------

  async generate(
    input: ImageGenAdapterInput,
  ): Promise<{ imageUrl?: string; imageBase64?: string } | null> {
    const token = await this.getAccessToken();

    // iRAG API: resolution/style are embedded in prompt text (e.g. "卡通画，1024*1024")
    // The prompt can also specify aspect ratio (e.g. "一张卡通画：可爱的兔子，1：1")
    let prompt = input.transcript;
    const style = process.env.WENXIN_STYLE?.trim();
    if (style) {
      prompt = `${style}风格：${prompt}`;
    }

    // 通过 IMAGE_ASPECT 环境变量控制宽高比（如 "a4" / "a5"），
    // 按 "1712*2432" 格式追加到 prompt 尾部，文心一格 iRAG API
    // 支持从提示词中解析尺寸限定。不额外引入 WENXIN_RESOLUTION 变量。
    const size = resolveImageSize();
    if (size) {
      prompt = `${prompt}，${size}`;
    }

    const timeoutMs = Math.min(
      Math.max(
        Number(process.env.WENXIN_HTTP_TIMEOUT_MS ?? 300_000),
        10_000,
      ),
      600_000,
    );
    const deadline = Date.now() + timeoutMs;

    // ---- 1. Submit task ----
    const submitUrl = `${SUBMIT_URL}?access_token=${encodeURIComponent(token)}`;
    const submitBody: Record<string, unknown> = { prompt };

    // Optional: custom timeout for the iRAG task itself
    const submitTaskTimeout = (() => {
      const t = Number(process.env.WENXIN_TASK_TIMEOUT_S);
      return [10, 30, 60, 90, 120, 300, 600, 900].includes(t) ? t : null;
    })();
    if (submitTaskTimeout) {
      submitBody.task_time_out = submitTaskTimeout;
    }

    let submitRes: Response;
    try {
      submitRes = await retryFetch(
        submitUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(submitBody),
          signal: AbortSignal.timeout(30_000),
        },
        'WENXIN_SUBMIT',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`WENXIN submit fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'WENXIN_SUBMIT_UNAVAILABLE',
        message: msg,
      });
    }

    if (!submitRes.ok) {
      const t = await submitRes.text().catch(() => '');
      throw new BadGatewayException({
        code: 'WENXIN_SUBMIT_ERROR',
        message: `Submit ${submitRes.status}: ${t.slice(0, 500)}`,
      });
    }

    const submitData = (await submitRes.json()) as {
      data?: { task_id?: string; primary_task_id?: number };
      error_code?: number;
      error_msg?: string;
    };

    // iRAG returns error_code/error_msg only on failure
    if (submitData.error_code !== undefined && submitData.error_code !== 0) {
      const msg = submitData.error_msg ?? String(submitData.error_code);
      this.logger.warn(`WENXIN submit rejected: error_code=${submitData.error_code} error_msg=${msg}`);
      throw new BadGatewayException({
        code: 'WENXIN_SUBMIT_REJECTED',
        message: msg,
      });
    }

    const taskId = submitData?.data?.task_id;
    if (!taskId) {
      this.logger.warn(
        `WENXIN submit: no task_id. error_code=${submitData.error_code} error_msg=${submitData.error_msg}`,
      );
      return null;
    }
    this.logger.log(`WENXIN task submitted: task_id=${taskId}`);

    // ---- 2. Poll for result ----
    const queryUrl = `${QUERY_URL}?access_token=${encodeURIComponent(token)}`;
    let polls = 0;

    while (Date.now() < deadline && polls < MAX_POLLS) {
      polls++;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      let queryRes: Response;
      try {
        queryRes = await retryFetch(
          queryUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ task_id: taskId }),
            signal: AbortSignal.timeout(30_000),
          },
          'WENXIN_POLL',
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ServiceUnavailableException({
          code: 'WENXIN_POLL_UNAVAILABLE',
          message: msg,
        });
      }

      if (!queryRes.ok) {
        const t = await queryRes.text().catch(() => '');
        throw new BadGatewayException({
          code: 'WENXIN_POLL_ERROR',
          message: `Poll ${queryRes.status}: ${t.slice(0, 500)}`,
        });
      }

      const queryData = (await queryRes.json()) as {
        data?: {
          task_id?: string;
          task_status?: string;
          task_progress?: number;
          sub_task_result_list?: Array<{
            sub_task_status?: string;
            sub_task_error_code?: number;
            final_image_list?: Array<{
              img_url?: string;
              img_approve_conclusion?: string;
            }>;
          }>;
        };
        error_code?: number;
        error_msg?: string;
      };

      const d = queryData.data;
      if (!d) {
        this.logger.warn(
          `WENXIN poll: no data. error_code=${queryData.error_code} error_msg=${queryData.error_msg}`,
        );
        return null;
      }

      const status = d.task_status;
      if (status === 'SUCCESS') {
        // Extract image URL from sub_task_result_list
        const results = d.sub_task_result_list ?? [];
        for (const sub of results) {
          if (sub.sub_task_error_code !== 0) {
            this.logger.warn(
              `WENXIN sub_task failed: error_code=${sub.sub_task_error_code}`,
            );
            continue;
          }
          const images = sub.final_image_list ?? [];
          for (const img of images) {
            const url = img.img_url?.trim();
            if (url) {
              this.logger.log(
                `WENXIN image ready after ${polls} polls, task_id=${d.task_id}`,
              );
              return { imageUrl: url };
            }
          }
        }
        this.logger.warn('WENXIN completed but no image url in results');
        return null;
      }

      if (status === 'FAILED') {
        this.logger.warn(
          `WENXIN task failed after ${polls} polls, task_id=${d.task_id}`,
        );
        return null;
      }

      // status === 'INIT' | 'WAIT' | 'RUNNING' → keep polling
    }

    throw new ServiceUnavailableException({
      code: 'WENXIN_POLL_TIMEOUT',
      message: `WENXIN task polling exceeded timeout (${timeoutMs}ms, ${polls} polls)`,
    });
  }
}
