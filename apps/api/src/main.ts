import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  app.enableCors({
    origin: '*', // Allow all for MVP, should be stricter in prod
  });

  await app.listen(3001); // API on 3001
}
bootstrap();
