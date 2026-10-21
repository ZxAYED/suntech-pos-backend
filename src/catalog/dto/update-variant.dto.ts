import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateVariantDto {
  @ApiPropertyOptional({
    description: 'Parent product UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  productId?: string;

  @ApiPropertyOptional({
    description: 'Variant display name',
    example: 'Blue / M',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Tenant-scoped SKU identifier',
    example: 'TSH-BLU-M',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Tenant-scoped Barcode / EAN',
    example: '890987654321',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({
    description: 'Selling price in BDT',
    example: 1250,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sellingPrice?: number;

  @ApiPropertyOptional({
    description: 'Cost price in BDT',
    example: 850,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costPrice?: number | null;

  @ApiPropertyOptional({
    description: 'Available stock quantity',
    example: 35,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    description: 'Variant active status for sales and display',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Target branch location UUID for branch stock adjustment',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;
}
