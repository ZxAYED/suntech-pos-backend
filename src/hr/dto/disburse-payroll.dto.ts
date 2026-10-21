import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class DisbursePayrollDto {
  @ApiProperty({ description: 'Payroll month (1-12)', example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Payroll year', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiPropertyOptional({
    description: 'Filter disbursement to branch location ID',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;
}
