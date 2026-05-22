import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import replyFrom from '@fastify/reply-from';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import { Registry, collectDefaultMetrics } from 'prom-client';
import type { IncomingHttpHeaders } from 'node:http';
import { parseBaseEnv } from '@fancy-print/config';
import {
  loadGatewayHttpsOptions,
  loadMtlsSerialMap,
  normalizeCertSerial,
} from './tls-config';

parseBaseEnv(process.env); // fail-fast on missing critical env vars

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

function proxyHandler(upstream: string) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    reply.from(upstream, {
      rewriteRequestHeaders: (request, headers) => {
        const id = String(request.headers['x-request-id'] ?? '');
        const out: Record<string, string | string[] | undefined> = {
          ...headers,
          'x-request-id': id,
        };
        const tp = singleHeader(
          request.headers as unknown as Record<string, unknown>,
          'traceparent',
        );
        if (tp) out.traceparent = tp;
        const ts = singleHeader(
          request.headers as unknown as Record<string, unknown>,
          'tracestate',
        );
        if (ts) out.tracestate = ts;
        const mtlsId = singleHeader(
          request.headers as unknown as Record<string, unknown>,
          'x-device-id-from-mtls',
        );
        if (mtlsId) out['x-device-id-from-mtls'] = mtlsId;
        return out as IncomingHttpHeaders;
      },
    });
  };
}

async function main() {
  const app = Fastify({
    logger: true,
    ...(httpsOpts ? { https: httpsOpts } : {}),
  });

  await app.register(replyFrom, {
    undici: { connections: 128, pipelining: 1 },
  });

  // ── Rate limiting ────────────────────────────────────────────────
  const rateLimitMax = Math.max(
    1,
    Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 100),
  );
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Prefer device/client id from headers for more granular limits
      const deviceId = req.headers['x-device-id-from-mtls'];
      if (typeof deviceId === 'string' && deviceId.trim()) return deviceId.trim();
      return req.ip;
    },
    allowList: (req) => {
      const url = req.url;
      // Health check & metrics are always allowed
      if (url === '/health' || url === '/metrics') return true;
      return false;
    },
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

  // ── Order-independent route registration ──────────────────────────
  // Route matching uses Fastify's Radix tree (find-my-way), so sibling
  // branches /v1/parent/* and /v1/* never conflict regardless of the
  // order they are registered below.

  const parentHandler = proxyHandler(parentBffUrl);
  app.all('/v1/parent', parentHandler);
  app.all('/v1/parent/*', parentHandler);

  const deviceHandler = proxyHandler(deviceApiUrl);
  app.all('/v1', deviceHandler);
  app.all('/v1/*', deviceHandler);

  // ── Built-in routes ───────────────────────────────────────────────

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
