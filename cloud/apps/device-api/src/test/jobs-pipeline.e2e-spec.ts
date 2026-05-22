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
import { parseBaseEnv, HttpExceptionFilter } from '@fancy-print/config';
import { AppModule } from '../app.module';

async function flushMicrotasks(times = 40): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

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

    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;
    delete process.env.MQTT_URL;
    delete process.env.JOBS_PERSISTENCE_PATH;
    process.env.ASR_DRIVER = 'stub';
    process.env.IMAGE_GEN_DRIVER = 'stub';
    process.env.DEVICE_DEV_CREDENTIALS = JSON.stringify({
      'e2e-device': 'e2e-secret',
    });

    parseBaseEnv(process.env);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
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

    const audioB64 = Buffer.from('fake-wav-bytes').toString('base64');
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

    let state = 'audio_received';
    for (let step = 0; step < 12 && state !== 'preview_ready'; step++) {
      const adv = await http.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/advance`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(adv.statusCode).toBe(200);
      await flushMicrotasks();
      const get = await http.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(get.statusCode).toBe(200);
      state = (JSON.parse(get.body) as { state: string }).state;
      if (state === 'failed') {
        throw new Error(
          `pipeline failed: ${JSON.stringify(JSON.parse(get.body))}`,
        );
      }
    }

    expect(state).toBe('preview_ready');

    const art = await http.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/artifact`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // light-my-request may report 200 while still setting `location` (redirect hop)
    expect(String(art.headers.location ?? '')).toMatch(/^https:\/\//);
    expect([302, 301, 307, 200]).toContain(art.statusCode);
  });
});
