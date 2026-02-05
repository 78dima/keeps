import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  // CORS
  app.enableCors({
    origin: '*', // Allow all for MVP, should be stricter in prod
  });

  await app.listen(3001); // API on 3001
}
bootstrap();
