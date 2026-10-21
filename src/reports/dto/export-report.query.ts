import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export enum ReportType {
  PAYROLL = 'payroll',
  SALES = 'sales',
}

export enum ReportFormat {
  CSV = 'csv',
  PDF = 'pdf',
}

export class ExportReportQueryDto {
  @ApiProperty({
    enum: ReportType,
    enumName: 'ReportType',
    description: 'Type of report to export',
  })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({
    enum: ReportFormat,
    enumName: 'ReportFormat',
    description: 'Format of the exported file',
  })
  @IsEnum(ReportFormat)
  format: ReportFormat;

  @ApiProperty({ description: 'Report month (1-12)', example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Report year', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiPropertyOptional({ description: 'Filter by branch location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Search term filter' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
