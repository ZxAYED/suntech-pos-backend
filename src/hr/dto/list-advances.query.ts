import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdvanceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class ListAdvancesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by branch location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by employee / cashier ID' })
  @IsOptional()
  @IsEntityId()
  cashierId?: string;

  @ApiPropertyOptional({ description: 'Month (1-12)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Year (e.g. 2026)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    enum: [...Object.values(AdvanceStatus), 'VOIDED'],
    description: 'Filter by advance status (PENDING, DEDUCTED, VOIDED)',
  })
  @IsOptional()
  @IsIn([...Object.values(AdvanceStatus), 'VOIDED'])
  status?: AdvanceStatus | 'VOIDED';

  @ApiPropertyOptional({
    description:
      'Whether to include soft-deleted / voided advances in history (Admin / authorized audit)',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({
    description: 'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
}
