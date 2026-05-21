import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { PolicyModule } from '../policy/policy.module';
import { JobsArtifactController } from './jobs-artifact.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [MqttModule, PolicyModule, AdaptersModule],
  controllers: [JobsArtifactController, JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
