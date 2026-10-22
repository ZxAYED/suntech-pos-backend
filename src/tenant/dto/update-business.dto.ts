import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateBusinessDto {
  @ApiPropertyOptional({
    description: 'Updated business company name',
    example: 'SunTech Retail Group Ltd.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}
