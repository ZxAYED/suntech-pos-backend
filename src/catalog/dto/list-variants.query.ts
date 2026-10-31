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

  @ApiPropertyOptional({
    description: 'Filter stock counts for a specific branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Filter variants by status ("ACTIVE", "INACTIVE", or "ALL")',
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
