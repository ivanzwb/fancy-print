import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { IPipelineQueue } from './pipeline-queue.token';

/**
 * In-process background task queue for pipeline advancement.
 *
 * Moves blocking vendor calls (ASR WebSocket, image gen polling) off the
 * HTTP request thread. Jobs are processed sequentially per concurrency
 * slot. On shutdown, waits for in-flight tasks to complete.
 *
 * Env: `PIPELINE_QUEUE_CONCURRENCY` (default 2, max 16).
 *
 * 水平扩展请改用 {@link PipelineQueueBullmqService}（`PIPELINE_QUEUE_BACKEND=bullmq` + `REDIS_URL`），见 GitHub #13。
 */
@Injectable()
export class PipelineQueueService implements IPipelineQueue, OnModuleDestroy {
  private readonly logger = new Logger(PipelineQueueService.name);
  private readonly maxConcurrency: number;
  private running = 0;
  private readonly pending: Array<{
    jobId: string;
    deviceId: string;
    fn: () => Promise<void>;
  }> = [];
  private destroyed = false;
  private activePromises: Promise<void>[] = [];

  constructor() {
    this.maxConcurrency = Math.min(
      Math.max(Number(process.env.PIPELINE_QUEUE_CONCURRENCY ?? 2), 1),
      16,
    );
    this.logger.log(
      `PipelineQueue: concurrency=${this.maxConcurrency}`,
    );
  }

  /**
   * Enqueue a pipeline advancement task.
   * Returns immediately — the caller can return the HTTP response without
   * waiting for the vendor calls to complete.
   */
  enqueue(jobId: string, deviceId: string, fn: () => Promise<void>): void {
    if (this.destroyed) {
      this.logger.warn(
        `PipelineQueue destroyed, dropping job_id=${jobId} device_id=${deviceId}`,
      );
      return;
    }
    this.pending.push({ jobId, deviceId, fn });
    this.processNext();
  }

  private processNext(): void {
    if (this.destroyed) return;
    if (this.running >= this.maxConcurrency) return;

    const item = this.pending.shift();
    if (!item) return;

    this.running++;
    const promise = item
      .fn()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Pipeline background job_id=${item.jobId} device_id=${item.deviceId} failed: ${msg}`,
        );
      })
      .finally(() => {
        this.running--;
        this.processNext();
      });
    this.activePromises.push(promise);

    // Cleanup resolved promises from the array to avoid memory leak
    promise.finally(() => {
      this.activePromises = this.activePromises.filter((p) => p !== promise);
    });
  }

  /** Drain remaining tasks (up to `timeoutMs`) on shutdown. */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const remaining = this.pending.length + this.running;
    if (remaining === 0) return;
    this.logger.log(
      `PipelineQueue: draining ${remaining} remaining task(s)…`,
    );
    // Wait for all in-flight promises
    const all = this.activePromises;
    if (all.length > 0) {
      await Promise.all(all);
    }
    this.logger.log('PipelineQueue: drained');
  }
}
