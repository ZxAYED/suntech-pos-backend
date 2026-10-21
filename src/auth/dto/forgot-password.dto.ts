import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';
import { LoginType } from './login-type.enum';

export class ForgotPasswordDto {
  @ApiProperty({
    enum: LoginType,
    description: 'Login type (ADMIN or BUSINESS_USER)',
    example: LoginType.ADMIN,
  })
  @IsEnum(LoginType)
  loginType: LoginType;

  @ApiProperty({
    description: 'Email (for Admin) or Public ID (for Business User / Cashier)',
    example: 'admin@suntech.pos',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ValidateBy({
    name: 'isAdminIdentifierEmail',
    validator: {
      validate(value: unknown, args: ValidationArguments): boolean {
        const dto = args.object as ForgotPasswordDto;

        if (dto.loginType !== LoginType.ADMIN) {
          return typeof value === 'string' && value.trim().length > 0;
        }

        return typeof value === 'string' && isEmail(value);
      },
      defaultMessage(): string {
        return 'identifier must be an email address for admin recovery';
      },
    },
  })
  identifier: string;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
