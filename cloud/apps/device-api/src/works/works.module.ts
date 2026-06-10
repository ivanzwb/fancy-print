import { Module } from '@nestjs/common';
import { WorksController } from './works.controller';

@Module({
  controllers: [WorksController],
})
export class WorksModule {}
