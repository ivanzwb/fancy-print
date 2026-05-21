import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DeviceRegistryService } from '../devices/device-registry.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DeviceJwtAuthGuard } from './device-jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    DeviceRegistryService,
    AuthService,
    DeviceJwtAuthGuard,
    { provide: APP_GUARD, useExisting: DeviceJwtAuthGuard },
  ],
  exports: [AuthService, DeviceJwtAuthGuard, DeviceRegistryService],
})
export class AuthModule {}
