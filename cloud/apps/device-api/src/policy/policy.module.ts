import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

@Module({
  providers: [PolicyService],
  controllers: [PolicyController],
  exports: [PolicyService],
})
export class PolicyModule {}
