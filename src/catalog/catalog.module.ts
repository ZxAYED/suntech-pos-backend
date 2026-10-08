import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { VariantController } from './variant.controller';
import { VariantImageController } from './variant-image.controller';
import { VariantImageService } from './variant-image.service';
import { VariantService } from './variant.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CategoryController,
    ProductController,
    VariantController,
    VariantImageController,
  ],
  providers: [
    CategoryService,
    ProductService,
    VariantService,
    VariantImageService,
  ],
})
export class CatalogModule {}
