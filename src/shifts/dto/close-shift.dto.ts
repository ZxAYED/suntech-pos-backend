import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CloseShiftDto {
  @ApiProperty({
    description:
      'Actual physical cash counted in drawer (in BDT / smallest currency units)',
    example: 8500,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  closingAmount: number;

  @ApiPropertyOptional({
    description: 'Optional shift closing remarks or discrepancy notes',
    example: 'Shortage of 50 BDT due to loose change rounding',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
