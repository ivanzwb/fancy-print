import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Doc §2.4.1: device activation / session (naming mirrors OpenAPI evolution). */
  @Public()
  @Post('device')
  deviceSession(
    @Body() body: { device_id?: string; device_secret?: string },
  ) {
    return this.auth.exchangeDeviceCredentials(
      body.device_id ?? '',
      body.device_secret ?? '',
    );
  }

  @Public()
  @Post('token')
  refresh(@Body() body: { refresh_token?: string }) {
    const rt = body.refresh_token?.trim();
    if (!rt) {
      throw new BadRequestException({
        code: 'MISSING_REFRESH_TOKEN',
        message: 'refresh_token is required',
      });
    }
    return this.auth.refreshAccessToken(rt);
  }
}
