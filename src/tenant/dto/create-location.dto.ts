import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;
}
