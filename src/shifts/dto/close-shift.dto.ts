import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CloseShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  closingAmount: number;
}
