import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description: 'Catalog variant ID (omit if custom item)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantId?: string;

  @ApiPropertyOptional({
    description:
      'Name of ad-hoc/custom item (required if variantId is not provided)',
    example: 'Custom service fee',
  })
  @ValidateIf((line: OrderLineDto) => !line.variantId?.trim())
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customItemName?: string;

  @ApiPropertyOptional({
    description:
      'Price for custom item in whole BDT (required if variantId is not provided)',
    minimum: 0,
    example: 500,
  })
  @ValidateIf((line: OrderLineDto) => !line.variantId?.trim())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiProperty({
    description: 'Quantity of items',
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({
    description: 'Tenant business ID (required for Admin checkout)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description:
      'Branch location ID where the order is placed (required for Admin checkout)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Customer contact phone number',
    example: '01711111111',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerNumber?: string;

  @ApiPropertyOptional({
    description:
      'Shift session ID. Omit to auto-attach current open shift; pass null explicitly to detach.',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((dto: CreateOrderDto) => dto.shiftId !== null)
  @IsString()
  shiftId?: string | null;

  @ApiProperty({
    type: [OrderLineDto],
    description: 'List of order line items',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];
}
