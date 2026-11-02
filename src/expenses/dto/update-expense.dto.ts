import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateExpenseDto {
  @ApiPropertyOptional({
    example: 18000,
    description: 'Updated expense amount in integer currency (must be positive)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({
    example: 'Office Monthly Rent - Updated',
    description: 'Updated title of the expense',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    enum: ExpenseCategory,
    description: 'Updated category classification of the expense',
  })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    example: 'Updated notes',
    description: 'Optional detailed notes regarding the expense',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '2026-10-22T10:00:00.000Z',
    description: 'ISO date when expense was incurred',
  })
  @IsOptional()
  @IsISO8601()
  spentAt?: string;

  @ApiPropertyOptional({
    example: 'loc-1',
    description: 'Optional location ID if expense applies to a specific branch',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    example: 'biz-1',
    description: 'Optional business ID for multi-business admins',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
