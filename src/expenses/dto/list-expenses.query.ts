import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory, ExpenseSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListExpensesQueryDto {
  @ApiPropertyOptional({
    enum: ExpenseSourceType,
    description:
      'Filter expenses by type (MANUAL, PAYROLL_NET). Note: SALARY_ADVANCE is tracked in the separate advance ledger and rejected with 400.',
  })
  @IsOptional()
  @IsEnum(ExpenseSourceType)
  type?: ExpenseSourceType;

  @ApiPropertyOptional({
    example: 10,
    description: 'Calendar month (1-12) to filter expenses',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    example: 2026,
    description: 'Calendar year to filter expenses',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    example: 'loc-1',
    description: 'Filter expenses by branch location',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ExpenseCategory,
    description: 'Filter expenses by category',
  })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    example: 'Rent',
    description: 'Keyword search in expense title or note',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'biz-1',
    description: 'Optional business ID for multi-business admins',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
