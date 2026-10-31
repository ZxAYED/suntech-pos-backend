import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CustomAttributeDto } from './custom-attribute.dto';

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

  @ApiPropertyOptional({
    description:
      'Multiple custom attributes / attachments for product (e.g. IMEI, Serial Number, Warranty, Model, Color). Accepts array of { key, value } or key-value object map.',
    example: [
      { key: 'IMEI', value: '358249012345678' },
      { key: 'Serial Number', value: 'SN-998822' },
      { key: 'Warranty', value: '1 Year Official' },
    ],
  })
  @IsOptional()
  customAttributes?: CustomAttributeDto[] | Record<string, any>;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  customFields?: CustomAttributeDto[] | Record<string, any>;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  attributes?: CustomAttributeDto[] | Record<string, any>;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes / multiple attachments',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  attachments?: CustomAttributeDto[] | Record<string, any>;

  @ApiPropertyOptional({
    description: 'Product active status for sales and display',
    example: true,
  })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Explicit status string ("ACTIVE" or "INACTIVE")',
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE'],
  })
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INACTIVE';
}
