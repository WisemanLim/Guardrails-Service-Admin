import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('admin');
  const port = Number(process.env.PORT ?? 8084);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Admin API listening on :${port} (prefix /admin)`);
}
bootstrap();
