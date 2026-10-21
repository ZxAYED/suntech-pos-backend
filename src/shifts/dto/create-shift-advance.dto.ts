import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateShiftAdvanceDto {
  @ApiProperty({
    description:
      'Advance withdrawal amount in BDT (capped at cashier remaining monthly salary and drawer cash)',
    example: 1000,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({
    description: 'Reason for early salary advance taken from cash drawer',
    example: 'Emergency transport fare',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
