import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';

@Module({
  imports: [AuthModule],
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
