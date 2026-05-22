export const PIPELINE_QUEUE = Symbol('PIPELINE_QUEUE');

/** Nest `useExisting` 别名，供 BullMQ worker 通过 `ModuleRef` 解析 `JobsService`，避免循环 import。 */
export const JOBS_SERVICE = Symbol('JOBS_SERVICE');

/**
 * 后台执行 Job 流水线一档（ASR / 审核 / 生图等），与 HTTP 线程解耦。
 * 实现可为进程内队列（默认）或 BullMQ（`PIPELINE_QUEUE_BACKEND=bullmq` + `REDIS_URL`）。
 */
export interface IPipelineQueue {
  enqueue(jobId: string, deviceId: string, fn: () => Promise<void>): void;
  onModuleDestroy(): Promise<void>;
}
