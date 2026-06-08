import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';
import { retryFetch } from '../vendor-http.service';

const SYNC_API_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

@Injectable()
export class QwenImageSyncAdapter implements ImageGenAdapter {
  private readonly logger = new Logger(QwenImageSyncAdapter.name);

  isConfigured(): boolean {
    return !!process.env.DASHSCOPE_API_KEY?.trim();
  }

  async generate(
    input: ImageGenAdapterInput,
  ): Promise<{ imageUrl?: string; imageBase64?: string } | null> {
    const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
    if (!apiKey) return null;

    const base =
      process.env.DASHSCOPE_BASE_URL?.trim() ||
      'https://dashscope.aliyuncs.com';
    const model = process.env.WANX_MODEL?.trim() || 'qwen-image-2.0-pro';
    const size = process.env.WANX_IMAGE_SIZE?.trim() || '2048*2048';
    const workspace = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
    const timeoutMs = Math.min(
      Math.max(Number(process.env.WANX_HTTP_TIMEOUT_MS ?? 180_000), 5000),
      600_000,
    );

    const url = `${base.replace(/\/$/, '')}${SYNC_API_PATH}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (workspace) headers['X-DashScope-WorkSpace'] = workspace;

    const body = {
      model,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: input.transcript }],
          },
        ],
      },
      parameters: {
        size,
        n: 1,
        watermark: false,
      },
    };

    this.logger.log(
      `[IMG_GEN][job_id=${input.jobId}] START (sync): model=${model}, ` +
      `prompt_len=${input.transcript.length}, size=${size}`,
    );

    let res: Response;
    try {
      res = await retryFetch(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        },
        'QWEN_IMAGE_SYNC',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] REQUEST_FAIL: ${msg}`,
      );
      throw new ServiceUnavailableException({
        code: 'QWEN_IMAGE_SYNC_UNAVAILABLE',
        message: msg,
      });
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] ERROR: HTTP ${res.status}, ` +
        `response=${t.slice(0, 500)}`,
      );
      throw new BadGatewayException({
        code: 'QWEN_IMAGE_SYNC_ERROR',
        message: `HTTP ${res.status}: ${t.slice(0, 500)}`,
      });
    }

    const json = (await res.json()) as {
      output?: {
        choices?: Array<{
          message?: {
            content?: Array<{ image?: string }>;
          };
        }>;
      };
      code?: string;
      message?: string;
    };

    if (json.code) {
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] REJECTED: code=${json.code}, message=${json.message}`,
      );
      throw new BadGatewayException({
        code: 'QWEN_IMAGE_SYNC_REJECTED',
        message: json.message ?? String(json.code),
      });
    }

    const imageUrl = json.output?.choices
      ?.find((ch) => ch.message?.content?.[0]?.image)
      ?.message?.content?.[0]?.image?.trim();

    if (!imageUrl) {
      this.logger.warn(
        `[IMG_GEN][job_id=${input.jobId}] NO_IMAGE: response missing image URL`,
      );
      return null;
    }

    this.logger.log(
      `[IMG_GEN][job_id=${input.jobId}] DONE: image_url=${imageUrl.slice(0, 80)}...`,
    );
    return { imageUrl };
  }
}
