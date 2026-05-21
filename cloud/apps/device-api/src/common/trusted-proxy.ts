/** Comma-separated IPs trusted to inject `x-device-id-from-mtls` (gateway / nginx). */
export function trustedProxyIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const list = (
    process.env.TRUSTED_PROXY_IPS ??
    '127.0.0.1,::1,::ffff:127.0.0.1'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(ip);
}
