import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description: 'Product display name (tenant-scoped uniqueness)',
    example: 'iPhone 15 Pro Max',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Detailed product description or marketing notes',
    example: 'Flagship Apple smartphone with Titanium finish and A17 Pro chip',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional parent category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Target business UUID under which this product is created (optional for Admin; defaults to active business)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
