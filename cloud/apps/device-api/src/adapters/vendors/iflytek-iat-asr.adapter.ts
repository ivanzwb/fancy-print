import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import WebSocket from 'ws';
import { buildIflytekIatWebSocketUrl } from './iflytek-iat-signing';
import type { AsrAdapter, AsrAdapterInput } from './asr-adapter.interface';

const FRAME_SIZE = 1280;
const FRAME_INTERVAL_MS = 40;
const DEFAULT_TIMEOUT_MS = 55_000;

function stripWavHeaderIfNeeded(buf: Buffer): Buffer {
  if (
    buf.length > 44 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WAVE'
  ) {
    return buf.subarray(44);
  }
  return buf;
}

function extractTextFromIatMessage(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as {
    code?: number;
    message?: string;
    data?: {
      result?: {
        ws?: Array<{ cw?: Array<{ w?: string }> }>;
      };
    };
  };
  if (typeof m.code === 'number' && m.code !== 0) {
    throw new BadGatewayException({
      code: 'IFLYTEK_IAT_ERROR',
      message: m.message ?? `IFLYTEK IAT code ${m.code}`,
    });
  }
  const wsArr = m.data?.result?.ws;
  if (!Array.isArray(wsArr)) return '';
  const parts: string[] = [];
  for (const seg of wsArr) {
    const cw = seg?.cw;
    if (!Array.isArray(cw)) continue;
    for (const c of cw) {
      if (typeof c?.w === 'string' && c.w) parts.push(c.w);
    }
  }
  return parts.join('');
}

/**
 * 讯飞开放平台 **语音听写（IAT）流式 WebAPI v2**（WebSocket）。
 *
 * 产品/架构图常统称「讯飞 AIUI」路线；本适配器使用同一开放平台账号下的 **IAT** 能力，
 * 需在控制台开通语音听写（流式版）并配置 `IFLYTEK_*` 环境变量。
 */
@Injectable()
export class IflytekIatAsrAdapter implements AsrAdapter {
  private readonly logger = new Logger(IflytekIatAsrAdapter.name);

  usesAudioStaging(): boolean {
    return this.isConfigured();
  }

  isConfigured(): boolean {
    return !!(
      process.env.IFLYTEK_APP_ID?.trim() &&
      process.env.IFLYTEK_API_KEY?.trim() &&
      process.env.IFLYTEK_API_SECRET?.trim()
    );
  }

  async transcribe(input: AsrAdapterInput): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const appId = process.env.IFLYTEK_APP_ID!.trim();
    const apiKey = process.env.IFLYTEK_API_KEY!.trim();
    const apiSecret = process.env.IFLYTEK_API_SECRET!.trim();
    const host = process.env.IFLYTEK_IAT_HOST?.trim() || 'iat-api.xfyun.cn';
    const encoding = process.env.IFLYTEK_IAT_ENCODING?.trim() || 'raw';
    const format =
      process.env.IFLYTEK_IAT_FORMAT?.trim() || 'audio/L16;rate=16000';
    const language = process.env.IFLYTEK_IAT_LANGUAGE?.trim() || 'zh_cn';
    const domain = process.env.IFLYTEK_IAT_DOMAIN?.trim() || 'iat';
    const accent = process.env.IFLYTEK_IAT_ACCENT?.trim() || 'mandarin';
    const timeoutMs = Math.min(
      Math.max(Number(process.env.IFLYTEK_IAT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS), 5000),
      120_000,
    );

    let audioBuf: Buffer;
    try {
      audioBuf = await this.resolveAudioBuffer(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`IFLYTEK IAT: failed to load audio: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'IFLYTEK_IAT_AUDIO_UNAVAILABLE',
        message: msg,
      });
    }

    if (!audioBuf.length) return null;

    if (encoding === 'raw') {
      audioBuf = stripWavHeaderIfNeeded(audioBuf);
    }

    const url = buildIflytekIatWebSocketUrl({ host, apiKey, apiSecret });
    const transcriptParts: string[] = [];

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
      let timer: ReturnType<typeof setTimeout>;

      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      };

      timer = setTimeout(() => {
        finish(
          new ServiceUnavailableException({
            code: 'IFLYTEK_IAT_TIMEOUT',
            message: 'IFLYTEK IAT websocket timeout',
          }),
        );
      }, timeoutMs);

      ws.on('error', (err) => finish(err));

      ws.on('close', () => {
        if (!settled) {
          finish(
            new BadGatewayException({
              code: 'IFLYTEK_IAT_CLOSED',
              message: 'IFLYTEK IAT websocket closed before final result',
            }),
          );
        }
      });

      ws.on('open', () => {
        void (async () => {
          try {
            if (audioBuf.length <= FRAME_SIZE) {
              ws.send(
                JSON.stringify({
                  common: { app_id: appId },
                  business: { language, domain, accent },
                  data: {
                    status: 0,
                    format,
                    encoding,
                    audio: audioBuf.toString('base64'),
                  },
                }),
              );
              await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
              ws.send(JSON.stringify({ data: { status: 2 } }));
            } else {
              let offset = 0;
              while (offset < audioBuf.length) {
                if (offset > 0) {
                  await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
                }
                const end = Math.min(offset + FRAME_SIZE, audioBuf.length);
                const slice = audioBuf.subarray(offset, end);
                const isFirst = offset === 0;
                const isLast = end >= audioBuf.length;
                const status = isFirst ? 0 : isLast ? 2 : 1;
                const payload: Record<string, unknown> = {
                  data: {
                    status,
                    format,
                    encoding,
                    audio: slice.toString('base64'),
                  },
                };
                if (isFirst) {
                  payload.common = { app_id: appId };
                  payload.business = { language, domain, accent };
                }
                ws.send(JSON.stringify(payload));
                offset = end;
              }
            }
          } catch (e) {
            finish(e);
          }
        })();
      });

      ws.on('message', (data) => {
        try {
          const text = typeof data === 'string' ? data : data.toString('utf8');
          const j = JSON.parse(text) as Record<string, unknown>;
          const piece = extractTextFromIatMessage(j);
          if (piece) transcriptParts.push(piece);
          const d = j.data as { status?: number } | undefined;
          if (d?.status === 2) finish();
        } catch (e) {
          finish(e);
        }
      });
    });

    const merged = transcriptParts.join('').trim();
    return merged || null;
  }

  private async resolveAudioBuffer(input: AsrAdapterInput): Promise<Buffer> {
    if (input.audioBase64?.trim()) {
      return Buffer.from(input.audioBase64.trim(), 'base64');
    }
    if (input.audioPresignedUrl?.trim()) {
      const res = await fetch(input.audioPresignedUrl.trim(), {
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`presigned GET ${res.status}`);
      }
      return Buffer.from(await res.arrayBuffer());
    }
    return Buffer.alloc(0);
  }
}
