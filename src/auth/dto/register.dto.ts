import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Full name of business owner',
    example: 'Ahmed Khan',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({
    description: 'Business owner email address',
    example: 'ahmed@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Strong password (minimum 8 characters)',
    minLength: 8,
    maxLength: 72,
    example: 'SuperSecure123!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message:
      'Password must include uppercase, lowercase, number, and special character',
  })
  password: string;

  @ApiPropertyOptional({
    description: 'Contact phone number',
    example: '+8801712345678',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phoneNumber?: string;
}
