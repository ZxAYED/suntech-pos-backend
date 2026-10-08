import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdvanceController } from './advance.controller';
import { AdvanceService } from './advance.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [AuthModule],
  controllers: [AdvanceController, PayrollController],
  providers: [AdvanceService, PayrollService],
})
export class HrModule {}
