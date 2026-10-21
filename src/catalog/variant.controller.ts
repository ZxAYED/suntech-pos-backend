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
import { VariantService } from './variant.service';

@ApiTags('Catalog - Variants')
@ApiBearerAuth()
@Controller('catalog/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VariantController {
  constructor(private readonly variants: VariantService) {}

  @Post()
  @ApiOperation({
    summary: 'Create variant in catalog',
    description:
      'Creates a product variant with tenant-scoped SKU and Barcode uniqueness.',
  })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({
    status: 409,
    description: 'SKU or Barcode already exists in this business',
  })
  @Roles(Role.ADMIN)
  @Idempotent()
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
    summary: 'List variants with filters',
    description:
      'Accessible by both ADMIN and CASHIER. Supports filtering by category, product, search, and low stock.',
  })
  @ApiResponse({ status: 200, description: 'Variants loaded' })
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
    summary: 'Get variant details by ID',
    description: 'Accessible by both ADMIN and CASHIER.',
  })
  @ApiResponse({ status: 200, description: 'Variant loaded' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Variant loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.get(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update variant',
    description:
      'Updates variant name, prices, SKU, barcode, or stock. Admin only.',
  })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ApiResponse({ status: 409, description: 'SKU or Barcode conflict' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Variant updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variants.update(admin, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete variant',
    description: 'Soft-deletes a variant from catalog. Admin only.',
  })
  @ApiResponse({ status: 200, description: 'Variant removed' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Variant removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.remove(admin, id);
  }
}
