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
  @IsEnum(LoginType)
  loginType: LoginType;

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
