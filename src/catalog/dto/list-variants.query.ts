import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListVariantsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter variants by category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter variants by product UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Search term by name, SKU, or barcode',
    example: 'Red',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter for items with low stock (<= 5) when set to "true"',
    example: 'true',
  })
  @IsOptional()
  @IsString()
  lowStockOnly?: string;
}
