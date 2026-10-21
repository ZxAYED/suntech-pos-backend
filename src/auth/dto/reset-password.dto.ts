import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token obtained from verify-otp' })
  @IsString()
  @MinLength(1)
  resetToken: string;

  @ApiProperty({
    description: 'New password (minimum 8 characters)',
    minLength: 8,
    maxLength: 72,
    example: 'NewSecurePass@123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
