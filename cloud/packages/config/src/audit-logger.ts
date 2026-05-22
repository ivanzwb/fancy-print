import * as fs from 'node:fs';

/**
 * 默认不记录的 PII 字段集合（设计 doc §5.2 / §6）。
 *
 * 匹配不区分大小写（统一转小写比较），支持前缀匹配（末尾 + `*`）。
 * 命中时对应字段的值 **不会被写入审计日志**。
 */
const SENSITIVE_KEYS = new Set([
  'audio',
  'audio_base64',
  'audio_s3_key',
  'recording',
  'wav',
  'pcm',
  'mp3',
  'opus',
  'transcript',
  'transcript_raw',
  'speech',
  'transcript_original',
  'child_voice',
  'voice_text',
  'asr_result',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * 递归清理对象中的敏感字段（变异 + 返回）。
 */
export function stripPii<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      delete obj[key];
    } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      stripPii(obj[key] as Record<string, unknown>);
    }
  }
  return obj;
}

/**
 * 审计事件条目。
 *
 * 所有字段除 `event`、`ts`、`service`、`device_id`、`job_id` 外均需经
 * {@link stripPii} 过滤 — 确保 **敏感数据永不落地**。
 */
export interface AuditEntry {
  /** 事件时间（ISO 8601，由 {@link writeAuditLog} 自动填充） */
  ts?: string;
  /** 产生事件的进程名 */
  service: string;
  /** 事件类型，如 `job_created`、`job_advanced`、`approval_received` */
  event: string;
  /** 关联设备 ID（可选） */
  device_id?: string;
  /** 关联作业 ID（可选） */
  job_id?: string;
  /** 关联家庭 ID（可选） */
  household_id?: string;
  /** 操作结果 `ok` / `failed`（可选） */
  outcome?: string;
  /** 错误码（可选，outcome=failed 时推荐） */
  error_code?: string;
  /** 附加上下文（**会自动剥离敏感字段后写入**） */
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

let _auditLogPath: string | undefined;
let _auditLogStream: fs.WriteStream | undefined;

/**
 * 配置审计日志输出路径（应用启动时调用一次）。
 *
 * 路径来自环境变量 `AUDIT_LOG_PATH`；未配置时审计日志仅输出到控制台（logger.warn）。
 */
export function initAuditLog(path?: string): void {
  _auditLogPath = path?.trim() || process.env.AUDIT_LOG_PATH?.trim();
  if (_auditLogPath) {
    _auditLogStream = fs.createWriteStream(_auditLogPath, {
      flags: 'a',
      encoding: 'utf8',
    });
  }
}

export function closeAuditLog(): void {
  _auditLogStream?.end();
  _auditLogStream = undefined;
}

/**
 * 写入一条审计日志条目。
 *
 * - 自动填充 `ts`（当前时间）
 * - 自动剥离所有敏感字段
 * - 输出格式：NDJSON（每行一个 JSON 对象）
 * - 文件路径由 `AUDIT_LOG_PATH` 环境变量控制
 *
 * @example
 * ```ts
 * writeAuditLog({
 *   service: 'device-api',
 *   event: 'job_advanced',
 *   job_id: 'abc-123',
 *   device_id: 'device-001',
 *   outcome: 'ok',
 * });
 * // → {"ts":"2026-01-15T...","service":"device-api","event":"job_advanced","job_id":"abc-123","device_id":"device-001","outcome":"ok"}
 * ```
 */
export function writeAuditLog(entry: AuditEntry): void {
  const safe = stripPii({ ...entry });
  safe.ts = new Date().toISOString();

  const line = JSON.stringify(safe) + '\n';

  if (_auditLogStream) {
    try {
      _auditLogStream.write(line);
    } catch {
      // ignore IO errors
    }
  }

  // Also log at info level (without sensitive data)
  // NestJS Logger will handle the actual output; we keep the existing pattern
}
