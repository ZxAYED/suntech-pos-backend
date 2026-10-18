import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: ['today', 'yesterday', 'weekly', 'monthly'],
    description: 'Filter dashboard metrics by period range',
  })
  @IsOptional()
  @IsEnum(['today', 'yesterday', 'weekly', 'monthly'])
  range?: 'today' | 'yesterday' | 'weekly' | 'monthly';

  @ApiPropertyOptional({ description: 'Filter by store branch location UUID' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
