import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Valid refresh token string' })
  @IsString()
  @MinLength(1)
  refreshToken: string;
}
