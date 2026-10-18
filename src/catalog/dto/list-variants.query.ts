import { IsOptional, IsString } from 'class-validator';

export class ListVariantsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  lowStockOnly?: string;
}
