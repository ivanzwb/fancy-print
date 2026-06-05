import 'reflect-metadata';
import { config } from 'dotenv';
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
  config(); // load .env file
  parseBaseEnv(process.env);
  initAuditLog();
  const adapter = new FastifyAdapter();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });

  // Register custom JSON parser that accepts empty bodies BEFORE NestJS
  // registers its own during app.init(). Android sends Content-Type:
  // application/json with an empty body (e.g., POST /v1/jobs/{id}/advance).
  // Fastify's default JSON parser rejects empty bodies — return {} instead.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    if (body && body.length > 0) {
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        done(e);
      }
    } else {
      done(null, {});
    }
  });
  // Mark the adapter as already initialised so NestJS skips its own
  // registerJsonContentParser / registerParserMiddleware during app.init().
  // This avoids the FST_ERR_CTP_ALREADY_PRESENT conflict.
  (adapter as unknown as { _isParserRegistered: boolean })._isParserRegistered = true;

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
