import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Updated product display name',
    example: 'iPhone 15 Pro Max (512GB)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated product description',
    example: 'Updated flagship smartphone description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated parent category UUID (pass null to unassign)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  categoryId?: string | null;

  @ApiPropertyOptional({
    description: 'Product active status for sales and display',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Explicit status string ("ACTIVE" or "INACTIVE")',
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE'],
  })
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description:
      'Updated custom attributes / attachments for product (pass null to clear). Accepts array of { key, value } or key-value object map.',
    example: [
      { key: 'IMEI', value: '358249012345678' },
      { key: 'Serial Number', value: 'SN-998822' },
    ],
  })
  @IsOptional()
  customAttributes?: any;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  customFields?: any;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  attributes?: any;

  @ApiPropertyOptional({
    description: 'Alias for customAttributes / multiple attachments',
    example: [{ key: 'IMEI', value: '358249012345678' }],
  })
  @IsOptional()
  attachments?: any;
}
