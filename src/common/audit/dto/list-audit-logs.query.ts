import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional() @IsString() @IsOptional() businessId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() locationId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() action?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() entityType?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() entityId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() actorId?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsDateString()
  @IsOptional()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsDateString()
  @IsOptional()
  to?: string;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}
