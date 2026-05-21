import fs from 'node:fs';
import type tls from 'node:tls';

export function loadGatewayHttpsOptions(): tls.TlsOptions | undefined {
  const keyPath = process.env.GATEWAY_TLS_KEY_PATH?.trim();
  const certPath = process.env.GATEWAY_TLS_CERT_PATH?.trim();
  if (!keyPath || !certPath) return undefined;

  const caPath = process.env.GATEWAY_TLS_CA_PATH?.trim();
  const opts: tls.TlsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    requestCert: true,
    rejectUnauthorized:
      process.env.GATEWAY_MTLS_REJECT_UNAUTHORIZED !== 'false',
  };
  if (caPath) opts.ca = fs.readFileSync(caPath);
  return opts;
}

export function loadMtlsSerialMap(): Record<string, string> {
  const raw = process.env.GATEWAY_MTLS_SERIAL_MAP_JSON?.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function normalizeCertSerial(serial: string): string {
  return serial.replace(/:/g, '').toUpperCase();
}
