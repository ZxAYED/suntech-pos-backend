import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVariantDto {
  @ApiProperty({
    description: 'Parent product UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @MinLength(1)
  productId: string;

  @ApiProperty({ description: 'Variant display name', example: 'Red / XL' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Tenant-scoped SKU identifier',
    example: 'TSH-RED-XL',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Tenant-scoped Barcode / EAN',
    example: '890123456789',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  barcode?: string;

  @ApiProperty({
    description: 'Selling price in BDT',
    example: 1200,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sellingPrice: number;

  @ApiPropertyOptional({
    description: 'Cost price in BDT',
    example: 800,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({
    description: 'Available stock quantity',
    example: 50,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    description: 'Target branch location UUID for initial branch stock',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;
}
