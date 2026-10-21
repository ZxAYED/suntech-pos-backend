import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCashierDto {
  @ApiProperty({
    description: 'Full name of cashier',
    example: 'Alex Rivera',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @ApiPropertyOptional({
    description:
      'Optional email address. If omitted, a synthetic email @cashiers.suntech.internal will be generated.',
    example: 'alex.rivera@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Mobile contact number (tenant-scoped uniqueness)',
    example: '+8801712345678',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phoneNumber?: string;

  @ApiProperty({
    description: 'Initial cashier password (minimum 8 characters)',
    example: 'Cashier@123',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @ApiProperty({
    description: 'Assigned branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @MinLength(1)
  locationId: string;

  @ApiProperty({
    description: 'Base monthly salary in BDT',
    example: 35000,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthlySalary: number;
}
