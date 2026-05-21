import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ParentAuthModule } from './auth/parent-auth.module';
import { HouseholdsController } from './households/households.controller';
import { HouseholdsStubService } from './households/households.stub.service';
import { MeController } from './me/me.controller';

@Module({
  imports: [ParentAuthModule],
  controllers: [AppController, MeController, HouseholdsController],
  providers: [HouseholdsStubService],
})
export class AppModule {}
