import { isIPv4, isIPv6 } from 'node:net';

/**
 * Parsed IP range spec: a network address + mask.
 * Both buffers have the same length (4 for IPv4, 16 for IPv6).
 */
interface IpRange {
  network: Buffer;
  mask: Buffer;
}

let cachedRanges: IpRange[] | null = null;
let cachedRaw = '';

function parseV6(ip: string): Buffer {
  const buf = Buffer.alloc(16, 0);
  let parts = ip.split(':');

  // Collapse "::" -> fill with zeroes
  const emptyIdx = parts.indexOf('');
  if (emptyIdx !== -1) {
    const before = parts.slice(0, emptyIdx);
    const after = parts.slice(emptyIdx + 1).filter((p) => p !== '');
    const zeros = 8 - before.length - after.length;
    parts = [...before, ...Array<string>(zeros).fill('0'), ...after];
  }

  for (let i = 0; i < 8; i++) {
    const val = parseInt(parts[i] || '0', 16);
    buf[i * 2] = (val >> 8) & 0xff;
    buf[i * 2 + 1] = val & 0xff;
  }

  return buf;
}

/**
 * Normalise an IP string to a Buffer (4 bytes for IPv4, 16 for IPv6).
 * IPv4-mapped IPv6 (`::ffff:x.x.x.x`) is normalised to 4-byte IPv4 so that
 * CIDR ranges written as IPv4 also cover connections arriving via IPv6 socket.
 */
function ipToBuffer(ip: string): Buffer | null {
  if (isIPv4(ip)) {
    return Buffer.from(ip.split('.').map(Number));
  }

  // Normalise ::ffff:x.x.x.x to plain IPv4
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (isIPv4(v4)) {
      return Buffer.from(v4.split('.').map(Number));
    }
  }

  if (isIPv6(ip)) {
    return parseV6(ip);
  }

  return null;
}

function buildMask(prefixBits: number, length: number): Buffer {
  const mask = Buffer.alloc(length, 0);
  for (let i = 0; i < length; i++) {
    const remaining = prefixBits - i * 8;
    if (remaining >= 8) {
      mask[i] = 0xff;
    } else if (remaining <= 0) {
      mask[i] = 0x00;
    } else {
      mask[i] = (0xff << (8 - remaining)) & 0xff;
    }
  }
  return mask;
}

function parseRange(spec: string): IpRange | null {
  const slashIdx = spec.indexOf('/');

  if (slashIdx !== -1) {
    // CIDR notation: 10.0.0.0/8  or  ::1/128
    const ipStr = spec.slice(0, slashIdx);
    const bits = parseInt(spec.slice(slashIdx + 1), 10);
    const binary = ipToBuffer(ipStr);
    if (!binary || !Number.isFinite(bits) || bits < 0) return null;

    const maxBits = binary.length * 8;
    if (bits > maxBits) return null;

    const mask = buildMask(bits, binary.length);
    const network = Buffer.alloc(binary.length);
    for (let i = 0; i < binary.length; i++) {
      network[i] = binary[i] & mask[i];
    }
    return { network, mask };
  }

  // Plain IP
  const binary = ipToBuffer(spec);
  if (!binary) return null;

  const mask = Buffer.alloc(binary.length, 0xff);
  return { network: binary, mask };
}

function loadRanges(): IpRange[] {
  const raw =
    process.env.TRUSTED_PROXY_IPS ?? '127.0.0.1,::1,::ffff:127.0.0.1';
  if (cachedRaw === raw && cachedRanges) return cachedRanges;

  cachedRanges = [];
  cachedRaw = raw;

  for (const s of raw.split(',')) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const range = parseRange(trimmed);
    if (range) cachedRanges.push(range);
  }

  return cachedRanges;
}

function ipInRange(ip: string, range: IpRange): boolean {
  const binary = ipToBuffer(ip);
  if (!binary) return false;
  // Length mismatch (e.g. IPv4 vs IPv6) → no match
  if (binary.length !== range.network.length) return false;

  for (let i = 0; i < binary.length; i++) {
    if ((binary[i] & range.mask[i]) !== range.network[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Check whether `ip` belongs to one of the trusted proxy IP ranges.
 *
 * Supported formats in `TRUSTED_PROXY_IPS` (comma-separated):
 *   - Plain IP  e.g. `10.0.0.1`, `::1`
 *   - CIDR      e.g. `10.0.0.0/8`, `192.168.0.0/16`, `::1/128`
 *   - IPv4-mapped IPv6  e.g. `::ffff:10.0.0.1` (normalised to plain IPv4)
 *
 * Default: `127.0.0.1,::1,::ffff:127.0.0.1`
 */
export function trustedProxyIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const ranges = loadRanges();
  return ranges.some((r) => ipInRange(ip, r));
}
