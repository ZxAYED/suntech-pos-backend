import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
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

  @ApiProperty({
    description: '6-digit OTP code received via email',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

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

  @ApiPropertyOptional({
    description: 'Optional legacy reset token (if previously generated)',
  })
  @IsOptional()
  @IsString()
  resetToken?: string;
}
