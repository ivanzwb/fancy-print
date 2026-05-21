import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import { Registry, collectDefaultMetrics } from 'prom-client';
import {
  loadGatewayHttpsOptions,
  loadMtlsSerialMap,
  normalizeCertSerial,
} from './tls-config';

const parentBffUrl = process.env.PARENT_BFF_URL ?? 'http://127.0.0.1:3002';
const deviceApiUrl = process.env.DEVICE_API_URL ?? 'http://127.0.0.1:3001';
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const httpsOpts = loadGatewayHttpsOptions();
const mtlsSerialMap = loadMtlsSerialMap();

function singleHeader(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const v = headers[name];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return undefined;
}

const proxyReplyOpts = {
  rewriteRequestHeaders: (
    originalReq: { headers: Record<string, unknown> },
    headers: Record<string, string | string[] | undefined>,
  ) => {
    const id = String(originalReq.headers['x-request-id'] ?? '');
    const out: Record<string, string | string[] | undefined> = {
      ...headers,
      'x-request-id': id,
    };
    const tp = singleHeader(originalReq.headers, 'traceparent');
    if (tp) out.traceparent = tp;
    const ts = singleHeader(originalReq.headers, 'tracestate');
    if (ts) out.tracestate = ts;
    const mtlsId = singleHeader(originalReq.headers, 'x-device-id-from-mtls');
    if (mtlsId) out['x-device-id-from-mtls'] = mtlsId;
    return out;
  },
};

async function main() {
  const app = Fastify({
    logger: true,
    ...(httpsOpts ? { https: httpsOpts } : {}),
  });

  app.addHook('onRequest', async (req, reply) => {
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

    if (httpsOpts && Object.keys(mtlsSerialMap).length > 0) {
      const existing = singleHeader(
        req.headers as Record<string, unknown>,
        'x-device-id-from-mtls',
      );
      if (!existing) {
        const sock = req.raw.socket as tls.TLSSocket | undefined;
        const cert = sock?.getPeerCertificate?.(true);
        if (cert?.serialNumber) {
          const serial = normalizeCertSerial(String(cert.serialNumber));
          const mapped = mtlsSerialMap[serial];
          if (mapped) {
            (req.headers as Record<string, string>)['x-device-id-from-mtls'] =
              mapped;
            reply.header('x-device-id-from-mtls', mapped);
          }
        }
      }
    }
  });

  await app.register(proxy, {
    upstream: parentBffUrl,
    prefix: '/v1/parent',
    rewritePrefix: '/v1/parent',
    http2: false,
    replyOptions: proxyReplyOpts,
  });

  await app.register(proxy, {
    upstream: deviceApiUrl,
    prefix: '/v1',
    rewritePrefix: '/v1',
    http2: false,
    replyOptions: proxyReplyOpts,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'gateway',
    tls: Boolean(httpsOpts),
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
    `gateway listening tls=${Boolean(httpsOpts)}; /v1/parent -> ${parentBffUrl}; /v1 -> ${deviceApiUrl}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
