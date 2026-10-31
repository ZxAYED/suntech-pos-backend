import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminDashboardScopeQueryDto } from './admin-dashboard-scope.query';

export class AdminDashboardRecentActivityQueryDto extends AdminDashboardScopeQueryDto {
  @ApiPropertyOptional({
    description: 'Number of recent receipts to fetch (default: 5, max: 50)',
    example: 5,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 5;
}
