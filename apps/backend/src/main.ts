import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });
    const configService = app.get(ConfigService);

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // CORS configuration
    const corsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:3000');
    app.enableCors({
      origin: corsOrigin,
      credentials: true,
    });

    // Global prefix
    app.setGlobalPrefix('api');

    const port = configService.get<number>('PORT', 4000);
    await app.listen(port);

    console.log(`🚀 Backend server running on http://localhost:${port}`);
    console.log(`📡 WebSocket server ready on ws://localhost:${port}`);
  } catch (error) {
    console.error('Error during bootstrap:', error);
  }
}

bootstrap();
