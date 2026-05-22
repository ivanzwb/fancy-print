import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Public } from '../common/public.decorator';
import { OidcService } from './oidc.service';

// FastifyReply augmented with setCookie by @fastify/cookie
interface CookieReply extends FastifyReply {
  setCookie(name: string, value: string, opts: Record<string, unknown>): void;
}
interface CookieRequest extends FastifyRequest {
  cookies: Record<string, string>;
}

/**
 * OIDC authorization endpoints for parent authentication.
 *
 * Routes (both public):
 *   GET /v1/parent/auth/oidc/login    — Return IdP redirect URL (frontend navigates)
 *   GET /v1/parent/auth/oidc/callback — Handle IdP callback, return tokens as JSON
 *
 * Requires `OIDC_ISSUER` env to be set. Falls back to dev login when unset.
 */
@Controller('auth/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(private readonly oidc: OidcService) {}

  @Public()
  @Get('login')
  async login(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ redirect_url: string }> {
    if (!this.oidc.isConfigured()) {
      throw new InternalServerErrorException({
        code: 'OIDC_NOT_CONFIGURED',
        message:
          'OIDC is not configured. Set OIDC_ISSUER and OIDC_CLIENT_ID, or use POST /v1/parent/auth/login.',
      });
    }

    const { url, state, codeVerifier } = await this.oidc.getAuthorizationUrl();

    // Store state + codeVerifier in httpOnly cookies so the callback can
    // retrieve them. Single-use, short-lived (10 min).
    const r = reply as unknown as CookieReply;
    r.setCookie('oidc_state', state, {
      path: '/v1/parent/auth/oidc/callback',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    r.setCookie('oidc_code_verifier', codeVerifier, {
      path: '/v1/parent/auth/oidc/callback',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });

    this.logger.debug(`OIDC login redirect: ${url.substring(0, 80)}…`);
    return { redirect_url: url };
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') _state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
  }> {
    if (error) {
      this.logger.warn(`OIDC callback error from provider: ${error}`);
      throw new BadRequestException({
        code: 'OIDC_PROVIDER_ERROR',
        message: `OIDC provider returned an error: ${error}`,
      });
    }

    if (!code) {
      throw new BadRequestException({
        code: 'OIDC_MISSING_CODE',
        message: 'Authorization code is required',
      });
    }

    const req = request as unknown as CookieRequest;
    const expectedState = req.cookies?.['oidc_state'];
    const codeVerifier = req.cookies?.['oidc_code_verifier'];

    if (!expectedState || !codeVerifier) {
      throw new UnauthorizedException({
        code: 'OIDC_SESSION_EXPIRED',
        message:
          'OIDC session expired or missing. Please start again from GET /v1/parent/auth/oidc/login.',
      });
    }

    // Build full callback URL so OidcService can parse code + state from it
    const urlObj = new URL(
      request.url,
      `${request.protocol}://${request.hostname}`,
    );

    return this.oidc.handleCallback(urlObj.href, codeVerifier, expectedState);
  }
}
