import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCashierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phoneNumber?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(1)
  locationId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthlySalary: number;
}
