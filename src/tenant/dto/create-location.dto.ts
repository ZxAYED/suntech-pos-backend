import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @ApiProperty({
    description: 'Branch or store location name',
    example: 'Uttara Branch',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Physical street address',
    example: 'Sector 3, Uttara, Dhaka',
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;
}
