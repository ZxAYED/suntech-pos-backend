import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OrderLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantId?: string;

  @ValidateIf((line: OrderLineDto) => !line.variantId?.trim())
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customItemName?: string;

  @ValidateIf((line: OrderLineDto) => !line.variantId?.trim())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerNumber?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];
}
