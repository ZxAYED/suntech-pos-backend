import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdvanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
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
    enum: AdvanceStatus,
    enumName: 'AdvanceStatus',
    description: 'Filter by advance status (PENDING, DEDUCTED)',
  })
  @IsOptional()
  @IsEnum(AdvanceStatus)
  status?: AdvanceStatus;

  @ApiPropertyOptional({
    description: 'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
}
