import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Valid refresh token string. Optional if the client sends the HttpOnly refreshToken cookie.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
