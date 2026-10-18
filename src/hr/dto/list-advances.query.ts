import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdvanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListAdvancesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by branch location UUID' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by employee / cashier ID' })
  @IsOptional()
  @IsString()
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
    description: 'Filter by advance status (PENDING, DEDUCTED)',
  })
  @IsOptional()
  @IsEnum(AdvanceStatus)
  status?: AdvanceStatus;
}
