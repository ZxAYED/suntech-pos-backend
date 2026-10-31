import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class UpdateCashierDto {
  @ApiPropertyOptional({
    description: 'Target business UUID for multi-business Admin',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Updated full name of cashier',
    example: 'Alex Rivera Updated',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Updated contact phone number',
    example: '+8801799999999',
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Reassigned store branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Updated base monthly salary in BDT',
    example: 38000,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  monthlySalary?: number;

  @ApiPropertyOptional({
    description: 'Reset cashier password (8-72 characters)',
    example: 'NewCashierPass@123',
    minLength: 8,
    maxLength: 72,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
