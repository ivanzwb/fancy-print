import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { JobsModule } from './jobs/jobs.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PolicyModule } from './policy/policy.module';

@Module({
  imports: [MqttModule, AuthModule, PolicyModule, DevicesModule, JobsModule],
  controllers: [AppController],
})
export class AppModule {}
