import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Aligns with doc/4 §3.1: machine `code` + human `message`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let code = 'HTTP_ERROR';
      let message = exception.message;
      let details: unknown;

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const body = res as Record<string, unknown>;
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
        if (body.message && Array.isArray(body.message)) {
          message = (body.message as string[]).join('; ');
        }
        if (body.details !== undefined) details = body.details;
      }

      if (status >= 500) {
        this.logger.warn(`${status} ${code}: ${message}`);
      }

      const payload: Record<string, unknown> = { code, message };
      if (details !== undefined) payload.details = details;
      return reply.status(status).send(payload);
    }

    this.logger.error(exception);
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
