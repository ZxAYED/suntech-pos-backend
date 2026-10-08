import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { OrderType } from '@prisma/client';

export class GetOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by store location UUID' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    enum: OrderType,
    description: 'Filter by order flow type (CATALOG or CUSTOM)',
  })
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
