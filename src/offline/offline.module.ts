import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';
import { OfflineCapabilityService } from './offline-capability.service';

@Module({
  imports: [AuthModule],
  controllers: [OfflineController],
  providers: [OfflineService, OfflineCapabilityService],
  exports: [OfflineCapabilityService],
})
export class OfflineModule {}
