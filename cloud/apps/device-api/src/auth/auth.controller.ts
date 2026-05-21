import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../common/public.decorator';
import { trustedProxyIp } from '../common/trusted-proxy';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('mtls')
  mtlsExchange(@Req() req: FastifyRequest) {
    if (process.env.MTLS_HEADER_TRUST !== '1') {
      throw new NotFoundException();
    }
    if (!trustedProxyIp(req.ip)) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_PROXY',
        message: 'Client IP not trusted for mTLS header auth',
      });
    }
    const raw = req.headers['x-device-id-from-mtls'];
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) {
      throw new BadRequestException({
        code: 'MISSING_DEVICE_MTLS_HEADER',
        message: 'x-device-id-from-mtls header is required',
      });
    }
    return this.auth.exchangeFromTrustedGateway(id);
  }

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
