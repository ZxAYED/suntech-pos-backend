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
  @IsString()
  @MinLength(1)
  productId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  barcode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sellingPrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;
}
