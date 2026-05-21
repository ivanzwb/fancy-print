/** Shared with HTTPS `POST /v1/devices/telemetry` and MQTT ingest (doc/4 §2.4.3). */
export const TELEMETRY_FORBIDDEN_BODY_KEYS = new Set([
  'audio',
  'recording',
  'wav',
  'pcm',
  'mp3',
  'opus',
  'transcript_raw',
  'speech',
]);

/** @returns forbidden key name or null */
export function findForbiddenTelemetryKey(
  raw: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(raw)) {
    if (TELEMETRY_FORBIDDEN_BODY_KEYS.has(key.toLowerCase())) return key;
  }
  return null;
}
