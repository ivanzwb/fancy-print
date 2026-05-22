import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { parseBaseEnv, HttpExceptionFilter, initAuditLog } from '@fancy-print/config';
import { AppModule } from './app.module';
import { httpRequestsTotal, metricsRegistry } from './common/metrics';

/** 创建 Nest 应用（未 listen）。供 HTTP 入口与纯 BullMQ Worker 共用。 */
export async function createApplication(): Promise<NestFastifyApplication> {
  parseBaseEnv(process.env);
  initAuditLog();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (req, reply, done) => {
    const raw = req.headers['x-request-id'];
    const id =
      typeof raw === 'string' && raw.trim() ? raw.trim() : randomUUID();
    req.headers['x-request-id'] = id;
    reply.header('x-request-id', id);
    const tp =
      typeof req.headers['traceparent'] === 'string'
        ? req.headers['traceparent'].trim()
        : undefined;
    if (tp) reply.header('traceparent', tp);
    const ts =
      typeof req.headers['tracestate'] === 'string'
        ? req.headers['tracestate'].trim()
        : undefined;
    if (ts) reply.header('tracestate', ts);
    done();
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    httpRequestsTotal.inc({
      method: req.method,
      status: String(reply.statusCode ?? 0),
    });
    done();
  });
  fastify.get('/metrics', async (_req, reply) => {
    reply
      .type(metricsRegistry.contentType)
      .send(await metricsRegistry.metrics());
  });

  return app;
}

/**
 * 不监听端口：只 `init()` 应用以启动 `PipelineQueueBullmqService` 内嵌 Worker，直到 SIGTERM/SIGINT。
 * 需 `PIPELINE_QUEUE_BACKEND=bullmq` 与 `REDIS_URL`。
 */
export async function runPipelineWorkerStandalone(): Promise<void> {
  const b = (process.env.PIPELINE_QUEUE_BACKEND ?? '').trim().toLowerCase();
  if (b !== 'bullmq' || !process.env.REDIS_URL?.trim()) {
    throw new Error(
      'Pipeline worker requires PIPELINE_QUEUE_BACKEND=bullmq and REDIS_URL',
    );
  }
  const app = await createApplication();
  await app.init();
  await new Promise<void>((resolve) => {
    const onStop = () => resolve();
    process.once('SIGTERM', onStop);
    process.once('SIGINT', onStop);
  });
  await app.close();
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await createApplication();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  return app;
}
