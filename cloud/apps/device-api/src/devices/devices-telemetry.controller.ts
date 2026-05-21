import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { CurrentDevice } from '../common/current-device.decorator';
import { deviceTelemetryPostsTotal } from '../common/metrics';
import { findForbiddenTelemetryKey } from '../common/telemetry-payload.guard';

/**
 * HTTPS 遥测入口（doc/4 §2.4.3 设备→云；MQTT 的并列/兜底桩）。
 * 禁止携带儿音原文或大块音频类字段名；仅接受脱敏摘要维度。
 */
@Controller('devices')
export class DevicesTelemetryController {
  private readonly logger = new Logger(DevicesTelemetryController.name);

  @Post('telemetry')
  @HttpCode(HttpStatus.NO_CONTENT)
  ingest(
    @CurrentDevice() dev: { device_id: string },
    @Body() body: Record<string, unknown>,
  ) {
    const raw = body ?? {};
    const forbidden = findForbiddenTelemetryKey(raw);
    if (forbidden) {
      deviceTelemetryPostsTotal.inc({ result: 'rejected' });
      throw new BadRequestException({
        code: 'TELEMETRY_FORBIDDEN_FIELD',
        message: `Field not allowed in telemetry payload: ${forbidden}`,
      });
    }

    const firmware =
      typeof raw.firmware_version === 'string'
        ? raw.firmware_version.trim().slice(0, 64)
        : undefined;
    if (raw.firmware_version !== undefined && !firmware) {
      deviceTelemetryPostsTotal.inc({ result: 'rejected' });
      throw new BadRequestException({
        code: 'INVALID_FIRMWARE_VERSION',
        message: 'firmware_version must be a non-empty string when provided',
      });
    }

    let rssi: number | undefined;
    if (raw.rssi_dbm !== undefined) {
      if (typeof raw.rssi_dbm !== 'number' || !Number.isFinite(raw.rssi_dbm)) {
        deviceTelemetryPostsTotal.inc({ result: 'rejected' });
        throw new BadRequestException({
          code: 'INVALID_RSSI',
          message: 'rssi_dbm must be a finite number when provided',
        });
      }
      rssi = raw.rssi_dbm;
    }

    let uptime: number | undefined;
    if (raw.uptime_sec !== undefined) {
      if (
        typeof raw.uptime_sec !== 'number' ||
        !Number.isInteger(raw.uptime_sec) ||
        raw.uptime_sec < 0
      ) {
        deviceTelemetryPostsTotal.inc({ result: 'rejected' });
        throw new BadRequestException({
          code: 'INVALID_UPTIME',
          message: 'uptime_sec must be a non-negative integer when provided',
        });
      }
      uptime = raw.uptime_sec;
    }

    this.logger.log(
      `device_telemetry_https device_id=${dev.device_id} firmware_version=${firmware ?? '-'} rssi_dbm=${rssi ?? '-'} uptime_sec=${uptime ?? '-'}`,
    );
    deviceTelemetryPostsTotal.inc({ result: 'accepted' });
  }
}
