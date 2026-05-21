import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/**
 * 统一 HTTP 异常处理 — 对齐 doc/4 §3.1 的 `code` + `message` 响应格式。
 *
 * - `HttpException` → 提取 status / code / message / details，≥500 记 warn 日志
 * - 未知异常 → 500 `INTERNAL_ERROR`
 *
 * 使用示例：
 * ```ts
 * import { HttpExceptionFilter } from '@fancy-print/config';
 * app.useGlobalFilters(new HttpExceptionFilter());
 * ```
 */
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
        if (Array.isArray(body.message)) {
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
