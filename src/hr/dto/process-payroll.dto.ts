import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class ProcessPayrollDto {
  @ApiProperty({
    description: 'Employee cashier ID to process payroll for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @MinLength(1)
  cashierId: string;

  @ApiProperty({
    description: 'Payroll month (1-12)',
    example: 10,
    minimum: 1,
    maximum: 12,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({
    description: 'Payroll year',
    example: 2026,
    minimum: 2000,
    maximum: 2100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
