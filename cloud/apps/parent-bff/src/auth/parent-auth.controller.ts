import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { ParentAuthService } from './parent-auth.service';

/**
 * 开发用家长登录/换票；量产由 OIDC / IdP 承担（见 doc/5、doc/4 §2.4.2）。
 * `POST /v1/parent/auth/login` + `POST /v1/parent/auth/token`
 */
@Controller('auth')
export class ParentAuthController {
  constructor(private readonly auth: ParentAuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email ?? '', body.password ?? '');
  }

  @Public()
  @Post('token')
  token(@Body() body: { refresh_token?: string }) {
    const rt = body.refresh_token?.trim();
    if (!rt) {
      throw new BadRequestException({
        code: 'MISSING_REFRESH_TOKEN',
        message: 'refresh_token is required',
      });
    }
    return this.auth.refresh(rt);
  }
}
