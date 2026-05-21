import * as fs from 'node:fs';

export function appendTelemetryNdjson(entry: {
  transport: 'https' | 'mqtt';
  device_id: string;
  summary: Record<string, unknown>;
}): void {
  const path = process.env.DEVICE_TELEMETRY_LOG_PATH?.trim();
  if (!path) return;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    }) + '\n';
  try {
    fs.appendFileSync(path, line, 'utf8');
  } catch {
    /* ignore IO errors */
  }
}
