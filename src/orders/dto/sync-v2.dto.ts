import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OrderType, PaymentMethod } from '@prisma/client';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';
import { SyncOrderItemDto, SyncOrderLineDto } from './sync-orders.dto';
import { INT_MAX } from '../money';

export class SyncV2LineDto extends SyncOrderLineDto {
  @Max(INT_MAX) declare quantity: number;
  @Max(INT_MAX) declare unitPrice: number;
}

export class SyncV2OrderDto extends SyncOrderItemDto {
  @IsEntityId() userId: string;
  @IsIn(['CURRENT_PRICE', 'CAPTURED_PRICE']) pricePolicy:
    'CURRENT_PRICE' | 'CAPTURED_PRICE';
  @IsString() @IsNotEmpty() @MaxLength(16000) grantToken: string;
  @IsInt() @Min(0) @Max(INT_MAX) declare tenderedAmount: number;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncV2LineDto)
  declare lines: SyncV2LineDto[];
}

export class SyncV2ScopeDto {
  @IsString() @IsNotEmpty() @MaxLength(100) deviceId: string;
  @IsEntityId() businessId: string;
  @IsEntityId() locationId: string;
}

export class SyncV2OrdersDto extends SyncV2ScopeDto {
  // Item validation is deliberately inside the loop, so one bad sale does not reject 99 good ones.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Type(() => SyncV2OrderDto)
  orders: SyncV2OrderDto[];
}

export class SyncV2StatusDto extends SyncV2ScopeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  clientOrderIds: string[];
}

export class ValidateLocalSaleDto extends SyncV2ScopeDto {
  @IsOptional() @IsEntityId() userId?: string;
  @IsEnum(OrderType) orderType: OrderType;
  @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @IsInt() @Min(0) @Max(INT_MAX) tenderedAmount: number;
  @ValidateIf((_object, value) => value !== null) @IsEntityId() shiftId:
    string | null;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncV2LineDto)
  lines: SyncV2LineDto[];
  @IsOptional() @IsString() @MaxLength(200) customerName?: string;
  @IsOptional() @IsString() @MaxLength(50) customerPhone?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
