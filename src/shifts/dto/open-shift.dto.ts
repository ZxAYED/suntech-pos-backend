import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class OpenShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startingAmount: number;

  @IsOptional()
  @IsBoolean()
  autoClosePrevious?: boolean;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
