import { z } from 'zod';

/**
 * 云端进程共享的基础环境变量。
 *
 * 各 Service 特有的变量（`IFLYTEK_*`、`WANX_*` 等）在其自身上下文中负责校验；
 * 此处仅包含 **多个 Service 共享** 或 **启动前必须 fail-fast** 的变量。
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535))
    .optional()
    .default('3000'),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  S3_AUDIO_BUCKET: z.string().optional(),
  S3_PREVIEW_BUCKET: z.string().optional(),
  AUDIT_LOG_PATH: z.string().optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * 解析并校验环境变量，缺失/类型错误时 **同步抛出 ZodError**（fail-fast）。
 *
 * 建议在 `main.ts` / 服务启动入口的最开始调用：
 *
 * ```ts
 * import { parseBaseEnv } from '@fancy-print/config';
 * parseBaseEnv(process.env); // throws on invalid config
 * ```
 */
export function parseBaseEnv(env: NodeJS.ProcessEnv): BaseEnv {
  return baseEnvSchema.parse(env);
}

// ── 共享 HTTP 异常过滤器 ──────────────────────────────────────────
export { HttpExceptionFilter } from './common/http-exception.filter';

// ── 审计日志 ──────────────────────────────────────────────────────
export { writeAuditLog, initAuditLog, closeAuditLog, stripPii } from './audit-logger';
export type { AuditEntry } from './audit-logger';
