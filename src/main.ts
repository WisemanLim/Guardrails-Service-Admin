import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

function parseOrigins(): string[] | true {
  const raw = (process.env.ADMIN_CORS_ORIGINS ?? '').trim();
  if (raw === '*') return true as unknown as string[];
  if (!raw) {
    // Sensible defaults: Admin Web dev (3001) + standalone preview (3000).
    return ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost:3000'];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('admin');

  // CORS — required because the Admin Web (Next.js) runs on a different
  // origin than the Admin API. Override via ADMIN_CORS_ORIGINS (CSV or "*").
  const origins = parseOrigins();
  app.enableCors({
    origin: origins === true ? true : origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    exposedHeaders: ['Content-Type'],
    maxAge: 600,
    credentials: false,
  });

  const port = Number(process.env.PORT ?? 8084);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Admin API listening on :${port} (prefix /admin, cors=${
      origins === true ? '*' : (origins as string[]).join(',')
    })`,
  );
}
bootstrap();
