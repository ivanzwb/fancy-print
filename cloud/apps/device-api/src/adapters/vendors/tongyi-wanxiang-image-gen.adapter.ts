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
// wanx-v1 (legacy) API — input.prompt format
// ---------------------------------------------------------------------------
const CREATE_PATH_V1 = '/api/v1/services/aigc/text2image/image-synthesis';

// ---------------------------------------------------------------------------
// wan2.7 (wan2.7-image-pro / wan2.7-image) API — input.messages format
// ---------------------------------------------------------------------------
const CREATE_PATH_V2 = '/api/v1/services/aigc/image-generation/generation';

const POLL_INTERVAL_MS = 500;
const MAX_POLLS = 240;

type TaskV2ChoiceMessageContent = {
  image?: string;
};

type TaskV2Choice = {
  finish_reason?: string;
  message?: {
    role?: string;
    content?: TaskV2ChoiceMessageContent[];
  };
};

type TaskPollOutput = {
  task_status?: string;
  results?: Array<{ url?: string; code?: string; message?: string }>;
  choices?: TaskV2Choice[];
  code?: string;
  message?: string;
};

const NEW_MODEL_PREFIXES = ['wan2.', 'qwen-image-'];

function isNewModel(model: string): boolean {
  return NEW_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

/**
 * 阿里云百炼 **通义万相** / **万相 2.7** 文生图，HTTP **异步创建 + 轮询任务**。
 *
 * 支持两种 DashScope API 风格：
 * - **v1**（默认 `wanx-v1`）：`/text2image/image-synthesis` + `input.prompt`。
 * - **v2**（`wan2.7-image-pro`、`wan2.7-image`、`qwen-image-*`）：`/image-generation/generation` + `input.messages`。
 *
 * 环境变量：`DASHSCOPE_API_KEY`（必填）、可选 `DASHSCOPE_BASE_URL`、`WANX_MODEL`、`WANX_IMAGE_SIZE`、`WANX_STYLE`、`IMAGE_ASPECT`。
 */
@Injectable()
export class TongyiWanxiangImageGenAdapter implements ImageGenAdapter {
  private readonly logger = new Logger(TongyiWanxiangImageGenAdapter.name);

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
    const model = process.env.WANX_MODEL?.trim() || 'wanx-v1';
    const newApi = isNewModel(model);

    // Size resolution: IMAGE_ASPECT → WANX_IMAGE_SIZE → built-in defaults
    const effectiveSize = resolveImageSize();
    const sizeLegacy = effectiveSize || process.env.WANX_IMAGE_SIZE?.trim() || '1024*1024';
    const sizeV2 = effectiveSize || process.env.WANX_IMAGE_SIZE?.trim() || '2K';
    const size = newApi ? sizeV2 : sizeLegacy;

    const style = process.env.WANX_STYLE?.trim();
    const negative = process.env.WANX_NEGATIVE_PROMPT?.trim();
    const workspace = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
    const timeoutMs = Math.min(
      Math.max(Number(process.env.WANX_HTTP_TIMEOUT_MS ?? 120_000), 5000),
      600_000,
    );
    const deadline = Date.now() + timeoutMs;

    const createPath = newApi ? CREATE_PATH_V2 : CREATE_PATH_V1;
    const createUrl = `${base.replace(/\/$/, '')}${createPath}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    };
    if (workspace) headers['X-DashScope-WorkSpace'] = workspace;

    const body: Record<string, unknown> = newApi
      ? {
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
        }
      : {
          model,
          input: {
            prompt: input.transcript,
            ...(negative ? { negative_prompt: negative } : {}),
          },
          parameters: {
            ...(style ? { style } : {}),
            size,
            n: 1,
          },
        };

    this.logger.log(
      `[IMG_GEN][job_id=${input.jobId}] START: model=${model}, ` +
      `content_mode=${input.contentMode}, ` +
      `prompt_len=${input.transcript.length}, ` +
      `is_v2=${newApi}, size=${size}, ` +
      `api_key_prefix=${apiKey.slice(0, 6)}...`,
    );

    let createRes: Response;
    try {
      createRes = await retryFetch(
        createUrl,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(60_000, timeoutMs)),
        },
        'WANX_CREATE',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] CREATE_FAIL: ${msg}`,
      );
      throw new ServiceUnavailableException({
        code: 'WANX_CREATE_UNAVAILABLE',
        message: msg,
      });
    }

    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] CREATE_ERROR: HTTP ${createRes.status}, ` +
        `response=${t.slice(0, 500)}`,
      );
      throw new BadGatewayException({
        code: 'WANX_CREATE_ERROR',
        message: `WANX create ${createRes.status}: ${t.slice(0, 500)}`,
      });
    }

    const created = (await createRes.json()) as {
      output?: { task_id?: string; task_status?: string };
      code?: string;
      message?: string;
    };
    const c = created.code;
    if (
      c !== undefined &&
      c !== null &&
      String(c).trim().length > 0
    ) {
      this.logger.error(
        `[IMG_GEN][job_id=${input.jobId}] CREATE_REJECTED: code=${c}, message=${created.message}`,
      );
      throw new BadGatewayException({
        code: 'WANX_CREATE_REJECTED',
        message: created.message ?? String(created.code),
      });
    }
    const taskId = created.output?.task_id?.trim();
    if (!taskId) {
      this.logger.warn('WANX create: missing task_id');
      return null;
    }

    this.logger.log(
      `[IMG_GEN][job_id=${input.jobId}] TASK_CREATED: task_id=${taskId}`,
    );

    const pollUrl = `${base.replace(/\/$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`;
    let polls = 0;
    while (Date.now() < deadline && polls < MAX_POLLS) {
      polls++;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let pollRes: Response;
      try {
        pollRes = await retryFetch(
          pollUrl,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30_000),
          },
          'WANX_POLL',
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `[IMG_GEN][job_id=${input.jobId}] POLL_FAIL: poll=${polls}, error=${msg}`,
        );
        throw new ServiceUnavailableException({
          code: 'WANX_POLL_UNAVAILABLE',
          message: msg,
        });
      }
      if (!pollRes.ok) {
        const t = await pollRes.text().catch(() => '');
        this.logger.error(
          `[IMG_GEN][job_id=${input.jobId}] POLL_ERROR: HTTP ${pollRes.status}, ` +
          `response=${t.slice(0, 500)}`,
        );
        throw new BadGatewayException({
          code: 'WANX_POLL_ERROR',
          message: `WANX poll ${pollRes.status}: ${t.slice(0, 500)}`,
        });
      }
      const polled = (await pollRes.json()) as {
        output?: TaskPollOutput;
        code?: string;
        message?: string;
      };
      const out = polled.output;
      const st = out?.task_status;

      this.logger.log(
        `[IMG_GEN][job_id=${input.jobId}] POLL: poll=${polls}, status=${st}`,
      );

      if (st === 'FAILED') {
        this.logger.error(
          `[IMG_GEN][job_id=${input.jobId}] TASK_FAILED: ` +
          `code=${out?.code}, message=${out?.message}`,
        );
        throw new BadGatewayException({
          code: 'WANX_TASK_FAILED',
          message: out?.message ?? polled.message ?? 'WANX task failed',
        });
      }
      if (st === 'SUCCEEDED') {
        // v1 format: output.results[].url
        const v1Url = out?.results?.find((r) => typeof r?.url === 'string')?.url;
        if (v1Url?.trim()) {
          this.logger.log(
            `[IMG_GEN][job_id=${input.jobId}] DONE: image_url=${v1Url.slice(0, 80)}..., ` +
            `format=v1, polls=${polls}`,
          );
          return { imageUrl: v1Url.trim() };
        }
        // v2 (wan2.7) format: output.choices[].message.content[].image
        const v2Url = (out?.choices as Array<{ message?: { content?: Array<{ image?: string }> } }> | undefined)
          ?.find((c) => typeof c?.message?.content?.[0]?.image === 'string')
          ?.message?.content?.[0]?.image;
        if (v2Url?.trim()) {
          this.logger.log(
            `[IMG_GEN][job_id=${input.jobId}] DONE: image_url=${v2Url.slice(0, 80)}..., ` +
            `format=v2, polls=${polls}`,
          );
          return { imageUrl: v2Url.trim() };
        }
        this.logger.warn('WANX SUCCEEDED but no url in results');
        return null;
      }
    }

    throw new ServiceUnavailableException({
      code: 'WANX_POLL_TIMEOUT',
      message: 'WANX task polling exceeded timeout',
    });
  }
}
