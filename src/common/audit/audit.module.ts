import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService, AuditReadService],
  exports: [AuditService, AuditReadService],
})
export class AuditModule {}
