import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ParentAuthModule } from './auth/parent-auth.module';
import { HouseholdsController } from './households/households.controller';
import { HouseholdsService } from './households/households.service';
import { MeController } from './me/me.controller';
import { MqttModule } from './mqtt/mqtt.module';

@Module({
  imports: [ParentAuthModule, MqttModule],
  controllers: [AppController, MeController, HouseholdsController],
  providers: [HouseholdsService],
})
export class AppModule {}
