import { Module } from '@nestjs/common';
import { AdaptersModule } from './adapters/adapters.module';
import { AppController } from './app.controller';
import { AsrModule } from './asr/asr.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { JobsModule } from './jobs/jobs.module';
import { MqttModule } from './mqtt/mqtt.module';
import { PolicyModule } from './policy/policy.module';
import { WorksModule } from './works/works.module';

@Module({
  imports: [
    MqttModule,
    AdaptersModule,
    AsrModule,
    AuthModule,
    PolicyModule,
    DevicesModule,
    JobsModule,
    WorksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
