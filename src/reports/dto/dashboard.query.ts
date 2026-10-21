import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: ['today', 'yesterday', 'weekly', 'monthly'],
    enumName: 'DashboardDateRange',
    description: 'Filter dashboard metrics by period range',
  })
  @IsOptional()
  @IsEnum(['today', 'yesterday', 'weekly', 'monthly'])
  range?: 'today' | 'yesterday' | 'weekly' | 'monthly';

  @ApiPropertyOptional({ description: 'Filter by store branch location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by business tenant UUID' })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
}
