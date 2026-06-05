/**
 * HTTP 集成测试：创建 Job → 上传音频 → 多次 advance → 预览就绪后拉 artifact。
 * 依赖桩 ASR/生图（无外部网络）；不连接 Redis/MQTT。
 */
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { config } from 'dotenv';
import { resolve } from 'path';
import { parseBaseEnv, HttpExceptionFilter } from '@fancy-print/config';
import { AppModule } from '../app.module';

/** Pipeline with real Baidu ASR + Tongyi image gen may take 90+ seconds. */
jest.setTimeout(180_000);

describe('device-api jobs pipeline (e2e)', () => {
  let app: NestFastifyApplication;
  const prevEnv: Record<string, string | undefined> = {};

  function saveEnv(key: string) {
    prevEnv[key] = process.env[key];
  }

  beforeAll(async () => {
    saveEnv('NODE_ENV');
    saveEnv('REDIS_URL');
    saveEnv('MQTT_URL');
    saveEnv('JOBS_PERSISTENCE_PATH');
    saveEnv('ASR_DRIVER');
    saveEnv('IMAGE_GEN_DRIVER');
    saveEnv('DEVICE_DEV_CREDENTIALS');
    // API keys loaded from .env — save originals to restore in afterAll
    saveEnv('BAIDU_ASR_API_KEY');
    saveEnv('BAIDU_ASR_SECRET_KEY');
    saveEnv('DASHSCOPE_API_KEY');
    saveEnv('WANX_MODEL');

    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;
    delete process.env.MQTT_URL;
    delete process.env.JOBS_PERSISTENCE_PATH;
    // Load .env for real API keys (Baidu ASR, DashScope), then select drivers
    config({ path: resolve(__dirname, '../../.env') });
    process.env.ASR_DRIVER = 'baidu';
    process.env.IMAGE_GEN_DRIVER = 'tongyi';
    process.env.DEVICE_DEV_CREDENTIALS = JSON.stringify({
      'e2e-device': 'e2e-secret',
    });

    parseBaseEnv(process.env);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: ['error', 'warn', 'log', 'debug', 'verbose'] },
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.setGlobalPrefix('v1', {
      exclude: [
        { path: 'health', method: RequestMethod.GET },
        { path: 'metrics', method: RequestMethod.GET },
      ],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('GET /health', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('create job → audio → advance until preview_ready → artifact redirect', async () => {
    const http = app.getHttpAdapter().getInstance();

    const authRes = await http.inject({
      method: 'POST',
      url: '/v1/auth/device',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        device_id: 'e2e-device',
        device_secret: 'e2e-secret',
      }),
    });
    expect(authRes.statusCode).toBe(201);
    const { access_token: accessToken } = JSON.parse(authRes.body) as {
      access_token: string;
    };
    expect(accessToken).toBeTruthy();

    const createRes = await http.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ content_mode: 'coloring_quiet_book' }),
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body) as { job_id: string };
    const jobId = created.job_id;

    // Real speech audio (M4A): macOS Tingting voice "今天天气真不错我想画一个小兔子", 0.5s
    const audioB64 = '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';
    const audioRes = await http.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/audio`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ audio_base64: audioB64 }),
    });
    expect(audioRes.statusCode).toBe(201);
    expect(JSON.parse(audioRes.body).state).toBe('audio_received');

    // With real adapters (Baidu ASR + Tongyi image gen), the pipeline can take
    // 30-60 seconds. Poll with exponential backoff instead of microtask flushes.
    const maxWaitMs = 120_000;
    const start = Date.now();
    let state = 'audio_received';
    await http.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/advance`,
      headers: {
        'x-device-id': 'e2e-device',
        authorization: `Bearer ${accessToken}`,
      },
    });
    for (let wait = 500; Date.now() - start < maxWaitMs; wait = Math.min(wait * 2, 10_000)) {
      await new Promise((r) => setTimeout(r, wait));
      const get = await http.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(get.statusCode).toBe(200);
      const body = JSON.parse(get.body) as { state: string; error_code?: string; error_message?: string };
      state = body.state;
      if (state === 'failed') break;
      if (state === 'preview_ready') break;
    }

    expect(state).toBe('preview_ready');

    const art = await http.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/artifact`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // light-my-request may report 200 while still setting `location` (redirect hop)
    expect(String(art.headers.location ?? '')).toMatch(/^https:\/\/|^data:image\//);
    expect([302, 301, 307, 200]).toContain(art.statusCode);
  });
});
