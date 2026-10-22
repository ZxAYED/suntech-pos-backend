import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAdvanceDto {
  @ApiProperty({
    description:
      'Advance withdrawal amount in BDT (strictly capped at employee remaining monthly salary)',
    example: 2000,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    description: 'Reason for requesting advance',
    example: 'Medical emergency',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Cashier user ID (required for Admin; implicit for Cashier)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  cashierId?: string;

  @ApiPropertyOptional({
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  businessId?: string;
}
