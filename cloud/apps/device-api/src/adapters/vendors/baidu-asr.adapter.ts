import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { AsrAdapter, AsrAdapterInput } from './asr-adapter.interface';
import * as https from 'node:https';
import { constants } from 'node:crypto';

interface BaiduTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface BaiduAsrResponse {
  err_no: number;
  err_msg: string;
  corpus_no?: string;
  sn?: string;
  result?: string[];
}

const DEFAULT_CUID = 'fancy-print';

@Injectable()
export class BaiduAsrAdapter implements AsrAdapter {
  private readonly logger = new Logger(BaiduAsrAdapter.name);

  private token: string | null = null;
  private tokenExpiry: number = 0; // epoch ms

  usesAudioStaging(): boolean {
    return false;
  }

  isConfigured(): boolean {
    return !!(
      process.env.BAIDU_ASR_API_KEY?.trim() &&
      process.env.BAIDU_ASR_SECRET_KEY?.trim()
    );
  }

  async transcribe(input: AsrAdapterInput): Promise<string | null> {
    if (!this.isConfigured()) return null;
    if (!input.audioBase64?.trim()) return null;

    const token = await this.getToken();
    const cuid = process.env.BAIDU_ASR_CUID?.trim() || DEFAULT_CUID;

    let audioBuf: Buffer;
    try {
      audioBuf = Buffer.from(input.audioBase64.trim(), 'base64');
    } catch {
      this.logger.warn('Baidu ASR: failed to decode audio base64');
      return null;
    }
    if (!audioBuf.length) return null;

    const audioBase64 = audioBuf.toString('base64');
    const format = this.guessFormat(input.contentMode);
    const rate = process.env.BAIDU_ASR_RATE?.trim() || '16000';

    const devPid = process.env.BAIDU_ASR_DEV_PID?.trim() || '1537';

    const body: Record<string, unknown> = {
      format,
      rate: Number(rate),
      channel: 1,
      cuid,
      token,
      speech: audioBase64,
      len: audioBuf.length,
      dev_pid: Number(devPid),
    };

    const timeoutMs = Math.min(
      Math.max(Number(process.env.BAIDU_ASR_TIMEOUT_MS ?? 120_000), 5_000),
      300_000,
    );

    try {
      const resBody = await this.httpsPost(
        'https://vop.baidu.com/server_api',
        JSON.stringify(body),
        timeoutMs,
      );

      const json = JSON.parse(resBody) as BaiduAsrResponse;

      if (json.err_no !== 0) {
        this.logger.warn(`Baidu ASR error ${json.err_no}: ${json.err_msg}`);
        // 101=invalid access_token, 102=token expired, 103=no permission
        if ([101, 102, 103].includes(json.err_no)) {
          this.token = null;
        }
        return null;
      }

      const text = (json.result ?? []).join('').trim();
      return text || null;
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Baidu ASR request failed: ${msg}`);
      throw new BadGatewayException({
        code: 'BAIDU_ASR_UNAVAILABLE',
        message: msg,
      });
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const apiKey = process.env.BAIDU_ASR_API_KEY!.trim();
    const secretKey = process.env.BAIDU_ASR_SECRET_KEY!.trim();

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: secretKey,
    });

    const resBody = await this.httpsPost(
      `https://aip.baidubce.com/oauth/2.0/token?${params.toString()}`,
      null, // GET-style via query params
      15_000,
    );

    const json = JSON.parse(resBody) as BaiduTokenResponse;

    if (json.error || !json.access_token) {
      throw new BadGatewayException({
        code: 'BAIDU_TOKEN_ERROR',
        message: json.error_description ?? json.error ?? 'unknown',
      });
    }

    this.token = json.access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiry =
      Date.now() + ((json.expires_in ?? 86400) - 300) * 1000;

    this.logger.log(`Baidu ASR token obtained, expires in ${json.expires_in}s`);
    return this.token!;
  }

    private guessFormat(contentMode: string): string {
    // The device records AAC in MP4 container via MediaRecorder
    // Baidu accepts: pcm, wav, amr, opus, speex, mp3, m4a
    const mode = (contentMode ?? '').toLowerCase();
    if (mode.includes('pcm')) return 'pcm';
    if (mode.includes('wav')) return 'wav';
    if (mode.includes('opus')) return 'opus';
    if (mode.includes('amr')) return 'amr';
    if (mode.includes('mp3')) return 'mp3';
    if (mode.includes('m4a')) return 'm4a';
    // Android records AAC-in-MP4 — Baidu expects 'm4a' for this container
    return 'm4a';
  }

  private httpsPost(
    url: string,
    jsonBody: string | null,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const body = jsonBody ?? undefined;
      const bodyBuf = body !== undefined ? Buffer.from(body, 'utf8') : undefined;

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
        },
        rejectUnauthorized: true,
        timeout: timeoutMs,
        secureOptions: constants.SSL_OP_NO_TLSv1_3,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new BadGatewayException({
              code: 'BAIDU_HTTP_ERROR',
              message: `Baidu HTTP ${res.statusCode}: ${text.slice(0, 500)}`,
            }));
          } else {
            resolve(text);
          }
        });
      });

      req.on('error', (err: Error) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('timeout'), { code: 'BAIDU_TIMEOUT' })); });

      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  }
}
