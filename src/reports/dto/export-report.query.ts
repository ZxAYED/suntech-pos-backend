import { Type } from 'class-transformer';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

export enum ReportType {
  PAYROLL = 'payroll',
  SALES = 'sales',
}

export enum ReportFormat {
  CSV = 'csv',
  PDF = 'pdf',
}

export class ExportReportQueryDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsEnum(ReportFormat)
  format: ReportFormat;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
