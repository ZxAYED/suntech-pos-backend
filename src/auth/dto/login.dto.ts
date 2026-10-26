import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    enum: LoginType,
    enumName: 'LoginType',
    description: 'Login type (ADMIN or BUSINESS_USER)',
    example: LoginType.ADMIN,
  })
  @IsEnum(LoginType)
  loginType: LoginType;

  @ApiPropertyOptional({
    description: 'Email address (required when loginType is ADMIN)',
    example: 'admin@suntech.pos',
  })
  @ValidateIf((dto: LoginDto) => dto.loginType === LoginType.ADMIN)
  @IsDefined()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Cashier public system ID, e.g. CSH-XXXXX (required when loginType is BUSINESS_USER)',
    example: 'CSH-K9M2P',
  })
  @ValidateIf((dto: LoginDto) => dto.loginType === LoginType.BUSINESS_USER)
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  publicId?: string;

  @ApiProperty({
    description: 'Account password',
    minLength: 8,
    maxLength: 72,
    example: 'Admin@123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
