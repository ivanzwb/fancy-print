import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import type { JobsService } from './jobs.service';
import { JOBS_SERVICE, type IPipelineQueue } from './pipeline-queue.token';

function queueName(): string {
  return (
    process.env.BULLMQ_PIPELINE_QUEUE_NAME?.trim() || 'fp:job-pipeline-advance'
  );
}

function bullmqConcurrency(): number {
  return Math.min(
    Math.max(Number(process.env.PIPELINE_QUEUE_CONCURRENCY ?? 8), 1),
    128,
  );
}

/**
 * Redis（BullMQ）分布式流水线队列：多 `device-api` 副本共享同一队列，水平扩展 worker 槽位。
 *
 * 需：`REDIS_URL`、`PIPELINE_QUEUE_BACKEND=bullmq`。
 * 可选：`BULLMQ_PIPELINE_QUEUE_NAME`（默认 `fp:job-pipeline-advance`）。
 *
 * @see GitHub #13
 */
@Injectable()
export class PipelineQueueBullmqService
  implements IPipelineQueue, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PipelineQueueBullmqService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      throw new Error(
        'PIPELINE_QUEUE_BACKEND=bullmq requires REDIS_URL to be set',
      );
    }
    const name = queueName();
    const concurrency = bullmqConcurrency();
    const connection = { url };
    this.logger.log(
      `BullMQ pipeline queue=${name} concurrency=${concurrency}`,
    );

    this.queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 500,
      },
    });

    this.worker = new Worker(
      name,
      async (job) => {
        const jobs = this.moduleRef.get<JobsService>(JOBS_SERVICE, {
          strict: false,
        });
        const { jobId, deviceId } = job.data as {
          jobId: string;
          deviceId: string;
        };
        await jobs.runBackgroundAdvance(jobId, deviceId);
      },
      { connection, concurrency },
    );

    this.worker.on('failed', (job, err) => {
      const id = job?.data && typeof job.data === 'object' ? (job.data as { jobId?: string }).jobId : '?';
      this.logger.error(`BullMQ job ${job?.id} job_id=${id}: ${err?.message ?? err}`);
    });
  }

  enqueue(jobId: string, deviceId: string, _fn: () => Promise<void>): void {
    void this.queue.add(
      'advance',
      { jobId, deviceId },
      { attempts: 1 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.worker?.close().catch(() => undefined),
      this.queue?.close().catch(() => undefined),
    ]);
  }
}
