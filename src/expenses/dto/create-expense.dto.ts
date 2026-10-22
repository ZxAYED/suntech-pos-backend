import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({
    example: 15000,
    description: 'Expense amount in integer currency (e.g. BDT)',
  })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({
    example: 'Office Monthly Rent',
    description: 'Brief title or description of the expense',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({
    enum: ExpenseCategory,
    default: ExpenseCategory.OTHER,
    description: 'Category classification of the expense',
  })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    example: 'Paid via bank transfer for Uttara shop premise',
    description: 'Optional detailed notes regarding the expense',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '2026-10-22T10:00:00.000Z',
    description: 'ISO date when expense was incurred (defaults to now)',
  })
  @IsOptional()
  @IsISO8601()
  spentAt?: string;

  @ApiPropertyOptional({
    example: 'b1a2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'Optional location ID if expense applies to a specific branch',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    example: 'biz-1234-uuid',
    description: 'Optional business ID (defaults to active admin business)',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
