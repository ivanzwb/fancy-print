import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { parseBaseEnv, HttpExceptionFilter } from '@fancy-print/config';
import { AppModule } from './app.module';
import { httpRequestsTotal, metricsRegistry } from './common/metrics';

async function bootstrap() {
  parseBaseEnv(process.env); // fail-fast on missing critical env vars
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

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
bootstrap();
