import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';

/**
 * In-process background task queue for pipeline advancement.
 *
 * Moves blocking vendor calls (ASR WebSocket, image gen polling) off the
 * HTTP request thread. Jobs are processed sequentially per concurrency
 * slot. On shutdown, waits for in-flight tasks to complete.
 *
 * Env: `PIPELINE_QUEUE_CONCURRENCY` (default 2, max 16).
 */
@Injectable()
export class PipelineQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(PipelineQueueService.name);
  private readonly maxConcurrency: number;
  private running = 0;
  private readonly pending: Array<{
    jobId: string;
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
  enqueue(jobId: string, fn: () => Promise<void>): void {
    if (this.destroyed) {
      this.logger.warn(
        `PipelineQueue destroyed, dropping job_id=${jobId}`,
      );
      return;
    }
    this.pending.push({ jobId, fn });
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
          `Pipeline background job_id=${item.jobId} failed: ${msg}`,
        );
      })
      .finally(() => {
        this.running--;
        this.processNext();
      });
    this.activePromises.push(promise);

    // Cleanup resolved promises to avoid memory leak
    this.activePromises = this.activePromises.filter((p) => p !== promise);
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
