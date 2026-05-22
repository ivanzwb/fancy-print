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
 *      When ?redirect_uri is provided to login, redirects there with tokens instead.
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
    @Query('redirect_uri') redirectUri: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ redirect_url: string } | void> {
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

    if (redirectUri) {
      // Mobile flow: store redirect_uri and redirect the browser to IdP.
      // After callback processing, the browser will be redirected to
      // redirectUri with tokens as query params.
      r.setCookie('oidc_redirect_uri', redirectUri, {
        path: '/v1/parent/auth/oidc/callback',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
      r.redirect(302, url);
      return;
    }

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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
  } | void> {
    if (error) {
      this.logger.warn(`OIDC callback error from provider: ${error}`);
      // For mobile flow with redirect_uri, redirect with error
      const r = reply as unknown as CookieReply;
      const redirectUri = (request as CookieRequest).cookies?.['oidc_redirect_uri'];
      if (redirectUri) {
        const loc = new URL(redirectUri);
        loc.searchParams.set('error', error);
        r.clearCookie('oidc_redirect_uri', { path: '/v1/parent/auth/oidc/callback' });
        r.redirect(302, loc.href);
        return;
      }
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

    const tokens = await this.oidc.handleCallback(
      urlObj.href,
      codeVerifier,
      expectedState,
    );

    // Mobile flow: redirect back to app with tokens in query params
    const redirectUri = req.cookies?.['oidc_redirect_uri'];
    if (redirectUri) {
      const r = reply as unknown as CookieReply;
      const loc = new URL(redirectUri);
      loc.searchParams.set('access_token', tokens.access_token);
      loc.searchParams.set('refresh_token', tokens.refresh_token);
      // Clean up cookies
      r.clearCookie('oidc_redirect_uri', { path: '/v1/parent/auth/oidc/callback' });
      r.clearCookie('oidc_state', { path: '/v1/parent/auth/oidc/callback' });
      r.clearCookie('oidc_code_verifier', { path: '/v1/parent/auth/oidc/callback' });
      r.redirect(302, loc.href);
      return;
    }

    return tokens;
  }
}
