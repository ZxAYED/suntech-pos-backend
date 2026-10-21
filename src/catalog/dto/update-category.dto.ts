import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCategoryDto {
  @ApiPropertyOptional({
    description: 'Updated category name',
    example: 'Smartphones & Flagships',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated category slug',
    example: 'smartphones-flagships',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    description: 'Updated category description',
    example: 'All flagship Android and iOS devices',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Category active status for sales and display',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
