import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/validate-env';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { HrModule } from './hr/hr.module';
import { ExpenseModule } from './expenses/expense.module';
import { MediaModule } from './media/media.module';
import { OrdersModule } from './orders/orders.module';
import { OfflineModule } from './offline/offline.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { SalaryMaskingInterceptor } from './common/interceptors/salary-masking.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { ShiftModule } from './shifts/shift.module';
import { TenantModule } from './tenant/tenant.module';
import { UserModule } from './users/user.module';
import { AuditModule } from './common/audit/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    PrismaModule,
    MediaModule,
    AuthModule,
    AdminModule,
    TenantModule,
    UserModule,
    CatalogModule,
    ShiftModule,
    OrdersModule,
    OfflineModule,
    ReportsModule,
    HrModule,
    ExpenseModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Idempotency stays outside the response wrapper so a replay returns the stored envelope once.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: SalaryMaskingInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
