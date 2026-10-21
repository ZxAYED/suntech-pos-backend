import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LoginType } from './login-type.enum';

export class ForgotPasswordDto {
  @ApiPropertyOptional({
    description: 'Admin registered email address',
    example: 'admin@suntechpos.bd',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    description: 'Admin email or identifier (backwards compatibility)',
    example: 'admin@suntechpos.bd',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  identifier?: string;

  @ApiPropertyOptional({
    enum: LoginType,
    enumName: 'LoginType',
    description:
      'Login type (ADMIN). Note: Cashiers do not have email recovery; their passwords are reset directly by Store Admins.',
    example: LoginType.ADMIN,
  })
  @IsOptional()
  @IsEnum(LoginType)
  loginType?: LoginType;
}
