import {
  IsDefined,
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { LoginType } from './login-type.enum';

export class LoginDto {
  @IsEnum(LoginType)
  loginType: LoginType;

  @ValidateIf((dto: LoginDto) => dto.loginType === LoginType.ADMIN)
  @IsDefined()
  @IsEmail()
  email?: string;

  @ValidateIf((dto: LoginDto) => dto.loginType === LoginType.BUSINESS_USER)
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  publicId?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
