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

async function bootstrap() {
  parseBaseEnv(process.env); // fail-fast on missing critical env vars
  initAuditLog(); // initialise audit log from AUDIT_LOG_PATH
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1/parent', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  const fastify = app.getHttpAdapter().getInstance();
  // Register @fastify/cookie for OIDC PKCE state cookies
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fc = require('@fastify/cookie');
  const fastifyCookie = typeof fc === 'function' ? fc : fc.default;
  await fastify.register(fastifyCookie);
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

  const port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
bootstrap();
