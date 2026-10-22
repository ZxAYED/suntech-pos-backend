import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

@ApiTags('Catalog - Products')
@ApiBearerAuth()
@Controller('catalog/products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @ApiOperation({
    summary: '[ADMIN] Create product in catalog',
    description:
      'Creates a product with tenant-scoped uniqueness on name. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Product with that name already exists in this business',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Product created')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(admin, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List products with filters & pagination',
    description:
      'List products with optional search, category, lowStock, and pagination. Accessible by ADMIN and CASHIER.',
  })
  @ApiResponse({
    status: 200,
    description: 'Products list and pagination meta returned',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Products loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.products.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get single product details with variants',
    description:
      'Returns product details including all non-deleted variants. Accessible by ADMIN and CASHIER.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product details returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Product loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.products.get(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '[ADMIN] Update product',
    description:
      'Updates product name, description, or categoryId. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Product with that name already exists',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Product updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(admin, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[ADMIN] Delete product',
    description: 'Soft-deletes product and its variants. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Product removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.products.remove(admin, id);
  }
}
