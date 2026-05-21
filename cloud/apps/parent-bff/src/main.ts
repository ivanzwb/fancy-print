import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1/parent', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  const port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
bootstrap();
