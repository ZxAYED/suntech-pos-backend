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
    description: 'Date range filter (e.g. today, weekly, monthly)',
    enum: ['today', 'yesterday', 'daily', 'weekly', 'monthly', 'quarterly'],
    enumName: 'TransactionLogDateRange',
  })
  @IsOptional()
  @IsIn(['today', 'yesterday', 'daily', 'weekly', 'monthly', 'quarterly'])
  range?: string;
}
