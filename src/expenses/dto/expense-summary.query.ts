import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory, ExpenseSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ExpenseSummaryQueryDto {
  @ApiPropertyOptional({
    enum: ExpenseSourceType,
    description: 'Filter expense summary by type (MANUAL, SALARY_ADVANCE, PAYROLL_NET)',
  })
  @IsOptional()
  @IsEnum(ExpenseSourceType)
  type?: ExpenseSourceType;

  @ApiPropertyOptional({
    example: 10,
    description: 'Calendar month (1-12). Defaults to current month.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    example: 2026,
    description: 'Calendar year (e.g., 2026). Defaults to current year.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    example: 'loc-1',
    description: 'Filter expense summary by branch location',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ExpenseCategory,
    description: 'Filter expense summary by category',
  })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    example: 'biz-1',
    description: 'Optional business ID for multi-business admins',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
