import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  return !origin || allowedOrigins.includes(origin);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const configuredFrontendUrl = configService.get<string>('FRONTEND_URL');
  const allowedOrigins = [
    configuredFrontendUrl,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (isAllowedCorsOrigin(origin, allowedOrigins)) {
        return callback(null, origin ?? true);
      }
      return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('api/v1', {
    exclude: ['/'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Suntech POS API')
    .setDescription(
      `Suntech Retail Point of Sale API documentation, including dual-engine order checkout (Catalog & Custom), multi-branch inventory, shift sessions, and payroll management.

### 👥 Role-Based Access Control (RBAC)
Endpoints are tagged with required access levels in brackets:
- **\`[PUBLIC]\`**: Open endpoints (Registration, Login, OTP, Reset Password, Health Check).
- **\`[CASHIER]\`**: Operational register endpoints for store staff.
- **\`[ADMIN]\`**: Store management endpoints for business owners/store managers.
- **\`[ADMIN, CASHIER]\`**: Shared operational endpoints accessible to both roles.
- **\`[SUPER_ADMIN]\`**: Platform-level oversight and admin approval endpoints.`,
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = Number(configService.get<string>('PORT', '3000'));
  await app.listen(port);
  console.log(`🚀 SunTech POS Backend is running on: http://localhost:${port}`);
  console.log(
    `📚 Swagger API Docs available at: http://localhost:${port}/api/docs`,
  );
  console.log(`🔗 API Base URL: http://localhost:${port}/api/v1`);
}

void bootstrap();
