import { IsString, Length, Matches } from 'class-validator';
import { ForgotPasswordDto } from './forgot-password.dto';

export class VerifyOtpDto extends ForgotPasswordDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
