import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PolicyModule } from '../policy/policy.module';
import { DevicesPolicyController } from './devices-policy.controller';
import { DevicesSessionsController } from './devices-sessions.controller';
import { DevicesTelemetryController } from './devices-telemetry.controller';

@Module({
  imports: [AuthModule, PolicyModule],
  controllers: [
    DevicesTelemetryController,
    DevicesSessionsController,
    DevicesPolicyController,
  ],
})
export class DevicesModule {}
