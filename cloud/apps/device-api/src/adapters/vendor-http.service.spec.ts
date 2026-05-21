import { VendorHttpService, retryFetch } from './vendor-http.service';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object that behaves correctly in Node.js. */
function mockRes(status: number, body = '', headers?: Record<string, string>): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new (globalThis as any).Headers(headers ?? { 'content-type': 'text/plain' }),
    json: async () => JSON.parse(body),
    text: async () => body,
    clone: function () { return mockRes(status, body, headers); },
  };
}

// ---------------------------------------------------------------------------
// Unit tests for retryFetch
// ---------------------------------------------------------------------------
describe('retryFetch', () => {
  const url = 'http://example.com/api';

  beforeEach(() => {
    delete process.env.MODERATION_HTTP_MAX_RETRIES;
    delete process.env.MODERATION_HTTP_RETRY_BASE_MS;
    delete process.env.MODERATION_HTTP_RETRY_MAX_MS;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return response on first success', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockRes(200));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should retry network error and succeed on retry', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(mockRes(200));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should retry 503 and succeed on retry', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockRes(503))
      .mockResolvedValueOnce(mockRes(200));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should retry 429 and succeed on retry', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockRes(429))
      .mockResolvedValueOnce(mockRes(200));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry 400 (client error)', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockRes(400));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(400);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry 422 (client error)', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockRes(422));

    const res = await retryFetch(url, {}, 'TEST');
    expect(res.status).toBe(422);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries and re-throw on persistent network errors', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(retryFetch(url, {}, 'TEST')).rejects.toThrow('ECONNREFUSED');
    // Default maxRetries=2 → 3 calls (0, 1, 2)
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should throw HTTP status on persistent 503', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockRes(503));

    await expect(retryFetch(url, {}, 'TEST')).rejects.toThrow('HTTP 503');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should respect maxRetries=0 env var (no retry)', async () => {
    process.env.MODERATION_HTTP_MAX_RETRIES = '0';
    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    await expect(retryFetch(url, {}, 'TEST')).rejects.toThrow('timeout');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests for VendorHttpService methods
// ---------------------------------------------------------------------------
describe('VendorHttpService (moderation)', () => {
  let svc: VendorHttpService;

  beforeEach(() => {
    svc = new VendorHttpService();
    delete process.env.MODERATION_TEXT_HTTP_URL;
    delete process.env.MODERATION_IMAGE_HTTP_URL;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -- moderateTextViaHttp ------------------------------------------------

  describe('moderateTextViaHttp', () => {
    const input = { jobId: 'job-1', contentMode: 'coloring_quiet_book', transcript: 'hello' };

    it('should return ok true when URL is not configured', async () => {
      const result = await svc.moderateTextViaHttp(input);
      expect(result).toEqual({ ok: true });
    });

    it('should return ok true for HTTP 200 with allowed: true', async () => {
      process.env.MODERATION_TEXT_HTTP_URL = 'http://moderate.example.com/text';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockRes(200, JSON.stringify({ allowed: true }), { 'content-type': 'application/json' }),
      );

      const result = await svc.moderateTextViaHttp(input);
      expect(result).toEqual({ ok: true });
    });

    it('should return ok false for HTTP 200 with banned content', async () => {
      process.env.MODERATION_TEXT_HTTP_URL = 'http://moderate.example.com/text';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockRes(200, JSON.stringify({ allowed: false, reason_code: 'VIOLENCE' }), { 'content-type': 'application/json' }),
      );

      const result = await svc.moderateTextViaHttp(input);
      expect(result).toEqual({ ok: false, reason_code: 'VIOLENCE' });
    });

    it('should throw ServiceUnavailableException when retries exhausted on network error', async () => {
      process.env.MODERATION_TEXT_HTTP_URL = 'http://moderate.example.com/text';
      process.env.MODERATION_HTTP_MAX_RETRIES = '1';
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(svc.moderateTextViaHttp(input)).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw BadGatewayException on non-retryable 4xx', async () => {
      process.env.MODERATION_TEXT_HTTP_URL = 'http://moderate.example.com/text';
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockRes(400));

      await expect(svc.moderateTextViaHttp(input)).rejects.toThrow(BadGatewayException);
      // 4xx is NOT retried — exactly 1 call
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // -- moderateImageViaHttp -----------------------------------------------

  describe('moderateImageViaHttp', () => {
    const input = { jobId: 'job-1', imageUrl: 'https://example.com/img.png' };

    it('should return ok true when URL is not configured', async () => {
      const result = await svc.moderateImageViaHttp(input);
      expect(result).toEqual({ ok: true });
    });

    it('should return ok false for blocked image', async () => {
      process.env.MODERATION_IMAGE_HTTP_URL = 'http://moderate.example.com/image';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockRes(200, JSON.stringify({ blocked: true, code: 'PORNOGRAPHY' }), { 'content-type': 'application/json' }),
      );

      const result = await svc.moderateImageViaHttp(input);
      expect(result).toEqual({ ok: false, reason_code: 'PORNOGRAPHY' });
    });
  });
});
