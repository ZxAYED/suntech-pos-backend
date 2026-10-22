import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class GetOrdersQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by business UUID (for Admin/SuperAdmin to scope orders to a specific business. Automatically extracted from token for Cashiers)',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Filter by store location ID' })
  @IsOptional()
  @IsEntityId()
  locationId?: string;

  @ApiPropertyOptional({
    enum: OrderType,
    enumName: 'OrderType',
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
    enumName: 'PaymentMethod',
    description: 'Filter by payment method (COD, BKASH, NAGAD, BANK)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    enum: OrderStatus,
    enumName: 'OrderStatus',
    description: 'Filter by order status (PAID, CANCELLED, REFUNDED)',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description:
      'Filter orders by period range (e.g. today, yesterday, weekly, monthly, week, month, year)',
    example: 'month',
  })
  @IsOptional()
  @IsString()
  range?: string;

  @ApiPropertyOptional({
    description:
      'Filter by month name or code (e.g. "october", "oct", "10", 10, "current")',
    example: 'october',
  })
  @IsOptional()
  month?: string | number;

  @ApiPropertyOptional({
    description: 'Filter by week number (1-53) or "current"',
    example: 'current',
  })
  @IsOptional()
  week?: string | number;

  @ApiPropertyOptional({
    description:
      'Filter by calendar year (e.g. 2026). Defaults to current year if month/week specified.',
    example: 2026,
  })
  @IsOptional()
  year?: string | number;

  @ApiPropertyOptional({
    description:
      'When true for Admin, returns only orders created/sold by the admin themselves. Default false (all business orders)',
    example: true,
  })
  @IsOptional()
  ownOrders?: boolean | string;

  @ApiPropertyOptional({
    description:
      'Order history scope: "all" for all business orders, "my" or "own" for orders sold by the current user',
    enum: ['all', 'my', 'own'],
    example: 'all',
  })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({
    description: 'Filter orders sold by a specific cashier or staff user ID',
  })
  @IsOptional()
  @IsEntityId()
  cashierId?: string;

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
