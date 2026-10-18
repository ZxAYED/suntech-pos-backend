import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: ['daily', 'weekly', 'monthly', 'quarterly'],
    description: 'Filter period analytics by range (default monthly)',
    default: 'monthly',
  })
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly', 'quarterly'])
  range?: 'daily' | 'weekly' | 'monthly' | 'quarterly' = 'monthly';

  @ApiPropertyOptional({ description: 'Filter by store branch location UUID' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
