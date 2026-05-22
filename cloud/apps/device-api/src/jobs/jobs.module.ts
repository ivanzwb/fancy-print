import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { PolicyModule } from '../policy/policy.module';
import { JobStateStoreService } from './job-state-store.service';
import { JobsArtifactController } from './jobs-artifact.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { PipelineQueueBullmqService } from './pipeline-queue-bullmq.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { JOBS_SERVICE, PIPELINE_QUEUE } from './pipeline-queue.token';

/** GitHub #13：多副本 + 水平 worker 时使用 BullMQ；否则进程内队列。 */
function useBullmqPipeline(): boolean {
  const b = (process.env.PIPELINE_QUEUE_BACKEND ?? '').trim().toLowerCase();
  return b === 'bullmq' && Boolean(process.env.REDIS_URL?.trim());
}

const pipelineProviders = useBullmqPipeline()
  ? [
      PipelineQueueBullmqService,
      { provide: PIPELINE_QUEUE, useExisting: PipelineQueueBullmqService },
    ]
  : [
      PipelineQueueService,
      { provide: PIPELINE_QUEUE, useExisting: PipelineQueueService },
    ];

@Module({
  imports: [MqttModule, PolicyModule, AdaptersModule],
  controllers: [JobsArtifactController, JobsController],
  providers: [
    JobStateStoreService,
    JobsService,
    { provide: JOBS_SERVICE, useExisting: JobsService },
    ...pipelineProviders,
  ],
  exports: [JobsService],
})
export class JobsModule {}
