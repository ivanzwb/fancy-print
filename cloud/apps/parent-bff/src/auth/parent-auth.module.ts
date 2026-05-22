import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { ParentAuthController } from './parent-auth.controller';
import { ParentAuthService } from './parent-auth.service';
import { ParentJwtAuthGuard } from './parent-jwt-auth.guard';
import { ParentRefreshTokenStoreService } from './refresh-token-store.service';

@Module({
  controllers: [ParentAuthController, OidcController],
  providers: [
    ParentAuthService,
    ParentJwtAuthGuard,
    ParentRefreshTokenStoreService,
    OidcService,
    { provide: APP_GUARD, useExisting: ParentJwtAuthGuard },
  ],
  exports: [ParentAuthService, ParentJwtAuthGuard, OidcService],
})
export class ParentAuthModule {}
