import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GetOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by store location UUID' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    enum: OrderType,
    description: 'Filter by order flow type (CATALOG or CUSTOM)',
  })
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @ApiPropertyOptional({
    description:
      'Search matching invoiceNumber, receiptNumber, customerName, customerPhone, or line items',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Filter by payment method (COD, BKASH, NAGAD, BANK)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Filter by order status (PAID, CANCELLED, REFUNDED)',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    enum: ['today', 'yesterday', 'weekly', 'monthly'],
    description: 'Filter orders by period range',
  })
  @IsOptional()
  @IsEnum(['today', 'yesterday', 'weekly', 'monthly'])
  range?: 'today' | 'yesterday' | 'weekly' | 'monthly';

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
