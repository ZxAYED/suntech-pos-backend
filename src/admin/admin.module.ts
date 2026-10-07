import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
