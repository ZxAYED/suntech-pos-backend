import {
  BadRequestException,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants.query';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { UpdateVariantStockDto } from './dto/update-variant-stock.dto';
import { VariantService } from './variant.service';

@ApiTags('Catalog - Variants')
@ApiBearerAuth()
@Controller('catalog/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VariantController {
  constructor(private readonly variants: VariantService) {}

  @Post()
  @ApiOperation({
    summary: '[ADMIN] Create variant in catalog',
    description:
      'Creates a product variant with tenant-scoped SKU and Barcode uniqueness. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'SKU or Barcode already exists in this business',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Variant created')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateVariantDto,
  ) {
    return this.variants.create(admin, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List variants with filters',
    description:
      'Accessible by both ADMIN and CASHIER. Supports filtering by category, product, search, low stock, branch location, and business.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search term by name, SKU, or barcode',
    example: 'Red',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Filter variants by category UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'productId',
    required: false,
    description: 'Filter variants by product UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'lowStockOnly',
    required: false,
    description: 'Filter for items with low stock (<= 5) when set to "true"',
    example: 'true',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter stock counts for a specific branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (starts at 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (e.g. 30)',
    example: 30,
  })
  @ApiResponse({ status: 200, description: 'Variants loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Variants loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListVariantsQueryDto,
  ) {
    return this.variants.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get variant details by ID',
    description: 'Accessible by both ADMIN and CASHIER.',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Optional branch location UUID to view branch-specific stock',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Variant loaded')
  get(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.variants.get(actor, id, businessId, locationId);
  }

  @Patch('stock')
  @ApiOperation({
    summary: '[ADMIN] Update variant stock',
    description:
      'Deducts, adds, or sets inventory stock. Custom sales do not use this endpoint. Takes variantId from payload body.',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant stock updated' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - insufficient stock or missing quantity',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN)
  @Idempotent()
  @ResponseMessage('Variant stock updated')
  updateStockBatch(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: UpdateVariantStockDto,
    @Query('businessId') businessId?: string,
  ) {
    if (!dto.variantId) {
      throw new BadRequestException(
        'variantId is required in body when not in path',
      );
    }
    return this.variants.updateStock(
      actor,
      dto.variantId,
      dto,
      businessId || dto.businessId,
    );
  }

  @Patch(':id/stock')
  @ApiOperation({
    summary: '[ADMIN] Update variant stock by ID',
    description:
      'Deducts, adds, or sets stock for a specific variant as an inventory adjustment.',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant stock updated' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - insufficient stock or missing quantity',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN)
  @Idempotent()
  @ResponseMessage('Variant stock updated')
  updateStock(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantStockDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.variants.updateStock(
      actor,
      id,
      dto,
      businessId || dto.businessId,
    );
  }

  @Post(':id/stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[ADMIN] Update variant stock by ID (POST alias)',
    description: 'POST alias for an inventory stock adjustment.',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant stock updated' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - insufficient stock or missing quantity',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN)
  @Idempotent()
  @ResponseMessage('Variant stock updated')
  updateStockPost(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantStockDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.variants.updateStock(
      actor,
      id,
      dto,
      businessId || dto.businessId,
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: '[ADMIN] Update variant',
    description:
      'Updates variant name, prices, SKU, barcode, or stock. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ApiResponse({ status: 409, description: 'SKU or Barcode conflict' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Variant updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.variants.update(admin, id, dto, businessId || dto.businessId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[ADMIN] Delete variant',
    description: 'Soft-deletes a variant from catalog. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Variant removed')
  remove(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.variants.remove(admin, id, businessId);
  }
}
