import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShiftStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class ListShiftsQueryDto {
  @ApiPropertyOptional({ description: 'Filter shifts by location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ShiftStatus,
    enumName: 'ShiftStatus',
    description: 'Filter by shift status',
  })
  @IsOptional()
  @IsEnum(ShiftStatus)
  status?: ShiftStatus;

  @ApiPropertyOptional({
    description: 'Filter shifts opened on or after date (YYYY-MM-DD in Asia/Dhaka)',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate must be in YYYY-MM-DD format',
  })
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Filter shifts opened on or before date (YYYY-MM-DD in Asia/Dhaka)',
    example: '2026-11-06',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate must be in YYYY-MM-DD format',
  })
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Filter shifts by cashier UUID (Admin lookup only)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  cashierId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size limit', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
}
