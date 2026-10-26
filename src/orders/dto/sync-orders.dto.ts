import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderType, PaymentMethod } from '@prisma/client';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class SyncOrderLineDto {
  @ApiPropertyOptional({ description: 'Catalog variant UUID' })
  @IsOptional()
  @IsEntityId()
  variantId?: string;

  @ApiPropertyOptional({ description: 'Cached product name snapshot' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @ApiPropertyOptional({ description: 'Cached variant name snapshot' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  variantName?: string;

  @ApiPropertyOptional({ description: 'Cached category name snapshot' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  categoryName?: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Price actually charged', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPrice: number;
}

export class SyncOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clientOrderId: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientReceiptNumber?: string;

  @ApiProperty({ description: 'Actual customer checkout timestamp' })
  @IsDateString()
  occurredAt: string;

  @ApiProperty({ enum: OrderType })
  @IsEnum(OrderType)
  orderType: OrderType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEntityId()
  shiftId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.COD })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tenderedAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [SyncOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncOrderLineDto)
  lines: SyncOrderLineDto[];
}

export class SyncOrdersDto {
  @ApiPropertyOptional({
    description: 'Selected business ID for Admin synchronization',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;
  @ApiPropertyOptional({
    description: 'Selected branch ID for Admin synchronization',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;
  @ApiProperty({ example: 'counter-01', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId: string;

  @ApiProperty({ type: [SyncOrderItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  orders: SyncOrderItemDto[];
}
