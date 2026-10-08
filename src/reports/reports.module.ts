import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { PdfService } from './pdf.service';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportController, ExportController],
  providers: [ReportService, ExportService, PdfService],
})
export class ReportsModule {}
