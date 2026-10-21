import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name (tenant-scoped uniqueness)',
    example: 'Smartphones & Mobile',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Custom URL slug (auto-generated from name if omitted)',
    example: 'smartphones-mobile',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    description: 'Optional category description',
    example: 'Handheld devices, smartphones, and mobile tech accessories',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
