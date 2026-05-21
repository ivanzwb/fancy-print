import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { httpRequestsTotal, metricsRegistry } from './common/metrics';

async function bootstrap() {
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
  fastify.addHook('onRequest', (req, _reply, done) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = id;
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
