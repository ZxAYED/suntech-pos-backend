import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SeedService } from './seed.service';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [AdminController],
  providers: [AdminService, SeedService],
  exports: [SeedService],
})
export class AdminModule {}
