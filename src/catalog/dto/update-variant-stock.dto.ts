import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export enum StockOperation {
  ADD = 'add',
  DEDUCT = 'deduct',
  SET = 'set',
}

export class UpdateVariantStockDto {
  @ApiPropertyOptional({
    description: 'Variant UUID (optional if provided in URL path)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  variantId?: string;

  @ApiPropertyOptional({
    enum: StockOperation,
    enumName: 'StockOperation',
    description:
      'Stock update operation: "deduct" to decrease quantity (custom sale checkout), "add" to increase, or "set" to assign absolute stock. Defaults to "deduct".',
    example: StockOperation.DEDUCT,
    default: StockOperation.DEDUCT,
  })
  @IsOptional()
  @IsEnum(StockOperation)
  operation?: StockOperation = StockOperation.DEDUCT;

  @ApiPropertyOptional({
    description:
      'Quantity units to deduct or add (e.g. 1, 2, 5). Can also be negative for deduction.',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Alternative quantity delta (+N to add, -N to deduct)',
    example: -1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  delta?: number;

  @ApiPropertyOptional({
    description:
      'Absolute stock value to set directly (alternative to quantity with operation "set")',
    example: 20,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    description:
      'Branch location UUID where stock is deducted or added (Cashier defaults to assigned location from token)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'Tenant business UUID (optional for Admin; Cashier locked to token business)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Audit note or invoice reference for the stock transaction',
    example: 'Custom sale checkout',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Whether to allow stock to go below zero (default false, rejects with 400 if stock is insufficient)',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  allowNegative?: boolean = false;
}
