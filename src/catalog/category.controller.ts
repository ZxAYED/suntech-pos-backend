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

@Controller('catalog/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post()
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
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Categories loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query('search') search?: string,
  ) {
    return this.categories.list(actor, search);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Category loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.get(actor, id);
  }

  @Patch(':id')
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
  @Roles(Role.ADMIN)
  @ResponseMessage('Category removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.remove(admin, id);
  }
}
