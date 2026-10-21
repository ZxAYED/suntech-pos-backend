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

export class CatalogOrderLineItemDto {
  @ApiProperty({ description: 'Catalog variant ID' })
  @IsEntityId()
  variantId: string;

  @ApiProperty({ description: 'Quantity purchased', minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Snapshot price submitted by client (verified against DB)',
    minimum: 0,
    example: 1500,
  })
  @IsInt()
  @Min(0)
  unitPrice: number;
}

export class CreateCatalogOrderDto {
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
    example: 3500,
  })
  @IsInt()
  @Min(0)
  tenderedAmount: number;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    default: PaymentMethod.COD,
    description: 'Payment method / type (COD, BKASH, NAGAD, BANK)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Alias for paymentMethod',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentType?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Customer full name',
    example: 'Rahim Khan',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    description: 'Customer phone number',
    example: '01711111111',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    description: 'Order notes or warranty info',
    example: 'IMEI: 123456789',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    type: [CatalogOrderLineItemDto],
    description: 'List of catalog items',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CatalogOrderLineItemDto)
  lines: CatalogOrderLineItemDto[];
}
