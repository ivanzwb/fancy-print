import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ParentAuthModule } from './auth/parent-auth.module';
import { HouseholdsController } from './households/households.controller';
import { HouseholdsService } from './households/households.service';
import { MeController } from './me/me.controller';

@Module({
  imports: [ParentAuthModule],
  controllers: [AppController, MeController, HouseholdsController],
  providers: [HouseholdsService],
})
export class AppModule {}
