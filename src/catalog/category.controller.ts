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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Catalog - Categories')
@ApiBearerAuth()
@Controller('catalog/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post()
  @ApiOperation({
    summary: 'Create product category',
    description:
      'Creates a category with tenant-scoped uniqueness on name and slug.',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({
    status: 409,
    description: 'Category name or slug already in use in this business',
  })
  @Roles(Role.ADMIN)
  @Idempotent()
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
    summary: 'List categories with inventory & sales metrics',
    description:
      'Returns categories with inventory value, stock units, and sales metrics computed in O(1) database aggregates. Available to both Admin and Cashier.',
  })
  @ApiResponse({ status: 200, description: 'Categories list returned' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Categories loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query('search') search?: string,
  ) {
    return this.categories.list(actor, search);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single category details',
    description: 'Returns category details and products.',
  })
  @ApiResponse({ status: 200, description: 'Category returned' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Category loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.get(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update category',
    description: 'Updates category name, slug, or description.',
  })
  @ApiResponse({ status: 200, description: 'Category updated' })
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
    summary: 'Delete category',
    description: 'Soft-deletes category and detaches linked products.',
  })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Category removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.remove(admin, id);
  }
}
