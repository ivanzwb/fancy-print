import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentDevice } from '../common/current-device.decorator';
import { PolicyService } from '../policy/policy.service';

/** Doc §2.4.1: `GET /v1/devices/{device_id}/policy` */
@Controller('devices')
export class DevicesPolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get(':deviceId/policy')
  getForDevice(
    @Param('deviceId') deviceId: string,
    @CurrentDevice() dev: { device_id: string },
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    if (dev.device_id !== deviceId) {
      throw new ForbiddenException({
        code: 'POLICY_DEVICE_MISMATCH',
        message: 'Bearer token device_id must match path device_id',
      });
    }
    const r = this.policy.maybeNotModified(ifNoneMatch);
    if (r.notModified) {
      res.status(304);
      return;
    }
    res.header('ETag', r.etag!);
    res.header('Cache-Control', 'private, max-age=60');
    return { ...r.body!, device_id: deviceId };
  }
}
