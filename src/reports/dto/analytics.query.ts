import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter period analytics by range (e.g. daily, weekly, monthly, quarterly, week, month, year). Default monthly ("month" = current month)',
    default: 'monthly',
    example: 'month',
  })
  @IsOptional()
  range?: string = 'monthly';

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

  @ApiPropertyOptional({ description: 'Filter by store branch location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by business tenant UUID' })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
}
