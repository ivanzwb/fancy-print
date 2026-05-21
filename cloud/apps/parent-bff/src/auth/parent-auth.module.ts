import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ParentAuthController } from './parent-auth.controller';
import { ParentAuthService } from './parent-auth.service';
import { ParentJwtAuthGuard } from './parent-jwt-auth.guard';

@Module({
  controllers: [ParentAuthController],
  providers: [
    ParentAuthService,
    ParentJwtAuthGuard,
    { provide: APP_GUARD, useExisting: ParentJwtAuthGuard },
  ],
  exports: [ParentAuthService, ParentJwtAuthGuard],
})
export class ParentAuthModule {}
