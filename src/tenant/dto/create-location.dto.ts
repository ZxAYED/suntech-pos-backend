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

  @ApiPropertyOptional({
    description:
      'Target business UUID under which this branch is created. Optional for Admin: if omitted, automatically attaches to your currently active business.',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
