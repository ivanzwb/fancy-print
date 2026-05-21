import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let code = 'HTTP_ERROR';
      let message = exception.message;
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const body = res as Record<string, unknown>;
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
        if (Array.isArray(body.message)) {
          message = (body.message as string[]).join('; ');
        }
      }
      if (status >= 500) {
        this.logger.warn(`${status} ${code}: ${message}`);
      }
      return reply.status(status).send({ code, message });
    }

    this.logger.error(exception);
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
