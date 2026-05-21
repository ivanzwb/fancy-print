import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import { Registry, collectDefaultMetrics } from 'prom-client';

const parentBffUrl = process.env.PARENT_BFF_URL ?? 'http://127.0.0.1:3002';
const deviceApiUrl = process.env.DEVICE_API_URL ?? 'http://127.0.0.1:3001';
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

async function main() {
  const app = Fastify({ logger: true });

  await app.register(proxy, {
    upstream: parentBffUrl,
    prefix: '/v1/parent',
    rewritePrefix: '/v1/parent',
    http2: false,
  });

  await app.register(proxy, {
    upstream: deviceApiUrl,
    prefix: '/v1',
    rewritePrefix: '/v1',
    http2: false,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'gateway',
    parent_bff: parentBffUrl,
    device_api: deviceApiUrl,
  }));

  app.get('/metrics', async (_req, reply) => {
    reply
      .type(metricsRegistry.contentType)
      .send(await metricsRegistry.metrics());
  });

  await app.listen({ port, host });
  app.log.info(
    `gateway listening; /v1/parent -> ${parentBffUrl}; /v1 -> ${deviceApiUrl}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
