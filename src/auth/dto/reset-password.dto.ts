import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  resetToken: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
