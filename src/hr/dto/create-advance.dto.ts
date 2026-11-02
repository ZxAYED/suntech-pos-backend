import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateAdvanceDto {
  @ApiProperty({
    description:
      'Advance withdrawal amount in whole BDT (recorded in Advance Ledger)',
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
}
