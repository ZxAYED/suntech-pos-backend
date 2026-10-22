import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class TransactionLogQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size limit', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by branch location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by business tenant UUID' })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Search matching order or cashier' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Date range filter (e.g. today, yesterday, daily, weekly, monthly, quarterly, week, month, year)',
    example: 'month',
  })
  @IsOptional()
  @IsString()
  range?: string;

  @ApiPropertyOptional({
    description:
      'Filter by month name or code (e.g. "october", "oct", "10", 10, "current")',
    example: 'october',
  })
  @IsOptional()
  month?: string | number;

  @ApiPropertyOptional({
    description: 'Filter by week number (1-53) or "current"',
    example: 'current',
  })
  @IsOptional()
  week?: string | number;

  @ApiPropertyOptional({
    description:
      'Filter by calendar year (e.g. 2026). Defaults to current year if month/week specified.',
    example: 2026,
  })
  @IsOptional()
  year?: string | number;
}
