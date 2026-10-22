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
  ApiQuery,
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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Catalog - Categories')
@ApiBearerAuth()
@Controller('catalog/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post()
  @ApiOperation({
    summary: '[ADMIN] Create product category',
    description:
      'Creates a category with tenant-scoped uniqueness on name and slug. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Category name or slug already in use in this business',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Category created')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categories.create(admin, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List categories with inventory & sales metrics',
    description:
      'Returns categories with inventory value, stock units, and sales metrics computed in O(1) database aggregates. Accessible by ADMIN and CASHIER.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search categories by name or description',
    example: 'Smartphones',
  })
  @ApiResponse({ status: 200, description: 'Categories list returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Categories loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query?: ListCategoriesQueryDto,
  ) {
    return this.categories.list(actor, query?.search, query?.locationId);
  }

  @Get(':id')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get single category details',
    description:
      'Returns category details and products. Accessible by ADMIN and CASHIER.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Category loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.get(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '[ADMIN] Update category',
    description:
      'Updates category name, slug, or description. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 409, description: 'Duplicate name or slug' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Category updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(admin, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[ADMIN] Delete category',
    description:
      'Soft-deletes category and detaches linked products. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Category removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.remove(admin, id);
  }
}
