import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { ForgotPasswordDto } from './forgot-password.dto';

export class VerifyOtpDto extends ForgotPasswordDto {
  @ApiProperty({ description: '6-digit OTP code', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
