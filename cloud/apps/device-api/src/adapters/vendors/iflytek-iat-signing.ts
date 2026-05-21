import { createHmac } from 'crypto';

export function buildIflytekIatWebSocketUrl(params: {
  host: string;
  apiKey: string;
  apiSecret: string;
}): string {
  const date = new Date().toUTCString();
  const path = '/v2/iat';
  const requestLine = `GET ${path} HTTP/1.1`;
  const signatureOrigin = `host: ${params.host}\ndate: ${date}\n${requestLine}`;
  const signature = createHmac('sha256', params.apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin = `api_key="${params.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin, 'utf8').toString(
    'base64',
  );
  const q = new URLSearchParams({
    authorization,
    date,
    host: params.host,
  });
  return `wss://${params.host}${path}?${q.toString()}`;
}
