import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DevicesTelemetryController } from './devices-telemetry.controller';

// Mock the common modules that the controller imports directly.
// jest.mock is hoisted above imports, so factory fns must inline jest.fn().
jest.mock('../common/metrics', () => ({
  deviceTelemetryPostsTotal: { inc: jest.fn() },
}));

jest.mock('../common/telemetry-payload.guard', () => ({
  findForbiddenTelemetryKey: jest.fn(),
}));

jest.mock('../common/telemetry-log', () => ({
  appendTelemetryNdjson: jest.fn(),
}));

import { deviceTelemetryPostsTotal } from '../common/metrics';
import { findForbiddenTelemetryKey } from '../common/telemetry-payload.guard';
import { appendTelemetryNdjson } from '../common/telemetry-log';
const mockInc = deviceTelemetryPostsTotal.inc as jest.Mock;
const mockFindForbidden = findForbiddenTelemetryKey as jest.Mock;
const mockAppendNdjson = appendTelemetryNdjson as jest.Mock;

describe('DevicesTelemetryController', () => {
  let controller: DevicesTelemetryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevicesTelemetryController],
    }).compile();

    controller = module.get(DevicesTelemetryController);
    jest.clearAllMocks();
  });

  const dev = { device_id: 'dev-42' };

  // ---------------------------------------------------------------------------
  // POST /v1/devices/telemetry — ingest
  // ---------------------------------------------------------------------------
  describe('ingest', () => {
    it('should accept minimal empty body (204)', () => {
      mockFindForbidden.mockReturnValue(null);

      const result = controller.ingest(dev, {});

      expect(result).toBeUndefined(); // @HttpCode(NO_CONTENT) + void return
      expect(mockFindForbidden).toHaveBeenCalledWith({});
      expect(mockInc).toHaveBeenCalledWith({ result: 'accepted' });
    });

    it('should accept null/undefined body gracefully', () => {
      mockFindForbidden.mockReturnValue(null);

      const result = controller.ingest(dev, null as any);

      expect(result).toBeUndefined();
      expect(mockFindForbidden).toHaveBeenCalledWith({});
    });

    it('should reject body with forbidden telemetry key', () => {
      mockFindForbidden.mockReturnValue('audio');

      expect(() => controller.ingest(dev, { audio: 'base64...' })).toThrow(
        BadRequestException,
      );
      expect(mockInc).toHaveBeenCalledWith({ result: 'rejected' });
    });

    it('should include TELEMETRY_FORBIDDEN_FIELD code in 400', () => {
      mockFindForbidden.mockReturnValue('transcript_raw');

      try {
        controller.ingest(dev, { transcript_raw: '...' });
      } catch (e: any) {
        expect(e.response.code).toBe('TELEMETRY_FORBIDDEN_FIELD');
        return;
      }
      throw new Error('Expected BadRequestException');
    });

    it('should reject invalid firmware_version (empty string)', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { firmware_version: '' }),
      ).toThrow(BadRequestException);
      expect(mockInc).toHaveBeenCalledWith({ result: 'rejected' });
    });

    it('should reject invalid firmware_version (whitespace only)', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { firmware_version: '   ' }),
      ).toThrow(BadRequestException);
    });

    it('should accept valid firmware_version', () => {
      mockFindForbidden.mockReturnValue(null);

      const result = controller.ingest(dev, {
        firmware_version: '2.1.0',
      });

      expect(result).toBeUndefined();
      expect(mockInc).toHaveBeenCalledWith({ result: 'accepted' });
      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          device_id: 'dev-42',
          summary: expect.objectContaining({
            firmware_version: '2.1.0',
          }),
        }),
      );
    });

    it('should truncate firmware_version to 64 chars', () => {
      mockFindForbidden.mockReturnValue(null);
      const long = 'a'.repeat(200);

      controller.ingest(dev, { firmware_version: long });

      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            firmware_version: 'a'.repeat(64),
          }),
        }),
      );
    });

    it('should accept valid rssi_dbm', () => {
      mockFindForbidden.mockReturnValue(null);

      controller.ingest(dev, { rssi_dbm: -65 });

      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({ rssi_dbm: -65 }),
        }),
      );
    });

    it('should reject non-number rssi_dbm', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { rssi_dbm: 'bad' }),
      ).toThrow(BadRequestException);
      expect(mockInc).toHaveBeenCalledWith({ result: 'rejected' });
    });

    it('should reject NaN rssi_dbm', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { rssi_dbm: NaN }),
      ).toThrow(BadRequestException);
    });

    it('should reject infinite rssi_dbm', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { rssi_dbm: Infinity }),
      ).toThrow(BadRequestException);
    });

    it('should accept valid uptime_sec', () => {
      mockFindForbidden.mockReturnValue(null);

      controller.ingest(dev, { uptime_sec: 3600 });

      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({ uptime_sec: 3600 }),
        }),
      );
    });

    it('should reject float uptime_sec', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { uptime_sec: 3.5 }),
      ).toThrow(BadRequestException);
    });

    it('should reject negative uptime_sec', () => {
      mockFindForbidden.mockReturnValue(null);

      expect(() =>
        controller.ingest(dev, { uptime_sec: -1 }),
      ).toThrow(BadRequestException);
    });

    it('should accept all fields simultaneously', () => {
      mockFindForbidden.mockReturnValue(null);

      controller.ingest(dev, {
        firmware_version: '3.0.0',
        rssi_dbm: -70,
        uptime_sec: 7200,
      });

      expect(mockInc).toHaveBeenCalledWith({ result: 'accepted' });
      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          device_id: 'dev-42',
          transport: 'https',
          summary: {
            firmware_version: '3.0.0',
            rssi_dbm: -70,
            uptime_sec: 7200,
          },
        }),
      );
    });

    it('should omit undefined optional fields from summary', () => {
      mockFindForbidden.mockReturnValue(null);

      controller.ingest(dev, {});

      expect(mockAppendNdjson).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: {
            firmware_version: undefined,
            rssi_dbm: undefined,
            uptime_sec: undefined,
          },
        }),
      );
    });
  });
});
