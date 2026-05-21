import { Controller, Get, Headers, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PolicyService } from './policy.service';

@Controller('policy')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  get(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = this.policy.maybeNotModified(ifNoneMatch);
    if (r.notModified) {
      res.status(304);
      return;
    }
    res.header('ETag', r.etag!);
    res.header('Cache-Control', 'private, max-age=60');
    return r.body;
  }
}
