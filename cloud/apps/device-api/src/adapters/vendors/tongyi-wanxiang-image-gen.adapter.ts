import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ImageGenAdapter, ImageGenAdapterInput } from './image-gen-adapter.interface';

const CREATE_PATH = '/api/v1/services/aigc/text2image/image-synthesis';
const POLL_INTERVAL_MS = 500;
const MAX_POLLS = 240;

type TaskPollOutput = {
  task_status?: string;
  results?: Array<{ url?: string; code?: string; message?: string }>;
  code?: string;
  message?: string;
};

/**
 * 阿里云百炼 **通义万相** 文生图（DashScope `wanx-v1` 等），HTTP **异步创建 + 轮询任务**。
 *
 * 环境变量：`DASHSCOPE_API_KEY`（必填）、可选 `DASHSCOPE_BASE_URL`、`WANX_MODEL`、`WANX_IMAGE_SIZE`、`WANX_STYLE`。
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
    const size = process.env.WANX_IMAGE_SIZE?.trim() || '1024*1024';
    const style = process.env.WANX_STYLE?.trim() || '<auto>';
    const negative = process.env.WANX_NEGATIVE_PROMPT?.trim();
    const workspace = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
    const timeoutMs = Math.min(
      Math.max(Number(process.env.WANX_HTTP_TIMEOUT_MS ?? 120_000), 5000),
      600_000,
    );
    const deadline = Date.now() + timeoutMs;

    const createUrl = `${base.replace(/\/$/, '')}${CREATE_PATH}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    };
    if (workspace) headers['X-DashScope-WorkSpace'] = workspace;

    const body: Record<string, unknown> = {
      model,
      input: {
        prompt: input.transcript,
        ...(negative ? { negative_prompt: negative } : {}),
      },
      parameters: {
        style,
        size,
        n: 1,
      },
    };

    let createRes: Response;
    try {
      createRes = await fetch(createUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(60_000, timeoutMs)),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`WANX create fetch failed: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'WANX_CREATE_UNAVAILABLE',
        message: msg,
      });
    }

    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
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

    const pollUrl = `${base.replace(/\/$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`;
    let polls = 0;
    while (Date.now() < deadline && polls < MAX_POLLS) {
      polls++;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let pollRes: Response;
      try {
        pollRes = await fetch(pollUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ServiceUnavailableException({
          code: 'WANX_POLL_UNAVAILABLE',
          message: msg,
        });
      }
      if (!pollRes.ok) {
        const t = await pollRes.text().catch(() => '');
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
      if (st === 'FAILED') {
        throw new BadGatewayException({
          code: 'WANX_TASK_FAILED',
          message: out?.message ?? polled.message ?? 'WANX task failed',
        });
      }
      if (st === 'SUCCEEDED') {
        const url = out?.results?.find((r) => typeof r?.url === 'string')?.url;
        if (url?.trim()) return { imageUrl: url.trim() };
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
