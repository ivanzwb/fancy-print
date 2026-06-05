import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { JobsModule } from '../jobs/jobs.module';
import { AsrController } from './asr.controller';

@Module({
  imports: [AdaptersModule, JobsModule],
  controllers: [AsrController],
})
export class AsrModule {}
