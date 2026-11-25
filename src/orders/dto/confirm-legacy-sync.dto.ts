import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SyncOrderItemDto } from './sync-orders.dto';

export class ConfirmLegacySyncDto {
  @ApiProperty({
    example: 'counter-01',
    description: 'Stable POS device identifier',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId: string;

  @ApiProperty({
    example: 'Audited physical paper receipt and cashier log book',
    description: 'Mandatory review justification',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @ApiProperty({
    type: SyncOrderItemDto,
    description: 'Original unhashed sync order item payload',
  })
  @ValidateNested()
  @Type(() => SyncOrderItemDto)
  order: SyncOrderItemDto;
}

