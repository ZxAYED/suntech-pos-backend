import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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
    description: 'Price per unit in whole BDT taka',
    minimum: 0,
    example: 500,
  })
  @IsInt()
  @Min(0)
  unitPrice: number;
}

export class CreateCustomOrderDto {
  @ApiPropertyOptional({
    description: 'Selected business ID for Admin checkout',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
  @ApiPropertyOptional({
    description:
      'Optional shift register ID. Pass null explicitly to prevent auto-attachment.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((dto: CreateCustomOrderDto) => dto.shiftId !== null)
  @IsEntityId()
  shiftId?: string | null;

  @ApiPropertyOptional({
    description:
      'Store location ID for Admin checkout. Cashier checkout always uses the location in the access token and ignores this field.',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiProperty({
    description: 'Amount tendered by customer in whole BDT taka',
    minimum: 0,
    example: 1000,
  })
  @IsInt()
  @Min(0)
  tenderedAmount: number;

  @ApiProperty({
    enum: PaymentMethod,
    enumName: 'PaymentMethod',
    description: 'Explicit payment method: COD, BKASH, NAGAD, BANK',
    example: PaymentMethod.COD,
  })
  @ValidateIf((dto: CreateCustomOrderDto) => !dto.paymentType)
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
