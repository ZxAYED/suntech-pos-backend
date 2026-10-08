import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class OpenShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startingAmount: number;
}
