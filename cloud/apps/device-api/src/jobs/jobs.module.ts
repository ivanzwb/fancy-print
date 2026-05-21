import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { JobsArtifactController } from './jobs-artifact.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [MqttModule],
  controllers: [JobsArtifactController, JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
