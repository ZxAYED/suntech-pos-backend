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
  ValidateNested,
} from 'class-validator';

export class RefundLineDto {
  @ApiProperty({
    description: 'Order line item UUID to refund',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @MinLength(1)
  orderItemId: string;

  @ApiProperty({ description: 'Quantity to refund', example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateRefundDto {
  @ApiPropertyOptional({
    description: 'Target business UUID for Admin users',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Active shift UUID for physical cash drawer payout',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  payoutShiftId?: string;

  @ApiPropertyOptional({
    description: 'Reason for processing refund',
    example: 'Customer returned damaged item',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({
    description: 'Array of line items to refund with item ID and quantity',
    type: [RefundLineDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  items: RefundLineDto[];
}
