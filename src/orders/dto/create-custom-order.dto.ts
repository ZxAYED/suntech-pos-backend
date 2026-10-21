import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export { PaymentMethod as PaymentType };

export class CustomOrderLineItemDto {
  @ApiProperty({
    description: 'Product or service title',
    example: 'iPhone 13 Camera Lens Protector',
  })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiPropertyOptional({
    description: 'Custom variant or style name',
    example: 'Matte Finish',
  })
  @IsString()
  @IsOptional()
  variantName?: string;

  @ApiProperty({ description: 'Quantity purchased', minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Price per unit in smallest currency unit (cents/paisa)',
    minimum: 0,
    example: 500,
  })
  @IsInt()
  @Min(0)
  unitPrice: number;
}

export class CreateCustomOrderDto {
  @ApiPropertyOptional({ description: 'Optional shift register ID' })
  @IsOptional()
  @IsEntityId()
  shiftId?: string;

  @ApiPropertyOptional({
    description: 'Store location ID (optional for cashiers)',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiProperty({
    description: 'Amount tendered by customer (in cents/paisa)',
    minimum: 0,
    example: 1000,
  })
  @IsInt()
  @Min(0)
  tenderedAmount: number;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    enumName: 'PaymentMethod',
    default: PaymentMethod.COD,
    description: 'Payment method / type (COD, BKASH, NAGAD, BANK)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    enumName: 'PaymentMethod',
    description: 'Alias for paymentMethod',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentType?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Customer full name',
    example: 'Karim Ahmed',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    description: 'Customer phone number',
    example: '01822222222',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    description: 'Order notes or warranty info',
    example: '7 days replacement warranty',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    type: [CustomOrderLineItemDto],
    description: 'List of custom items',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomOrderLineItemDto)
  lines: CustomOrderLineItemDto[];
}
