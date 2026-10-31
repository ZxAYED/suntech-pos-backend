import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SeedService } from './seed.service';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [AdminController, AdminDashboardController],
  providers: [AdminService, SeedService, AdminDashboardService],
  exports: [SeedService, AdminDashboardService],
})
export class AdminModule {}
