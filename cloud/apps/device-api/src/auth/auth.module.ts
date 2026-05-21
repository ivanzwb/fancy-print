import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DeviceJwtAuthGuard } from './device-jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    DeviceJwtAuthGuard,
    { provide: APP_GUARD, useExisting: DeviceJwtAuthGuard },
  ],
  exports: [AuthService, DeviceJwtAuthGuard],
})
export class AuthModule {}
