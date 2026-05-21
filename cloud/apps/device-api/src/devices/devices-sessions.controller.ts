import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { AuthService } from '../auth/auth.service';

/** Doc §2.4.1 alternate path: `POST /v1/devices/sessions`. */
@Controller('devices')
export class DevicesSessionsController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('sessions')
  sessions(
    @Body() body: { device_id?: string; device_secret?: string },
  ) {
    return this.auth.exchangeDeviceCredentials(
      body.device_id ?? '',
      body.device_secret ?? '',
    );
  }
}
