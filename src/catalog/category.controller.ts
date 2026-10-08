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
@Roles(Role.ADMIN)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post()
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
  @ResponseMessage('Categories loaded')
  list(@CurrentUser() admin: AccessTokenPayload) {
    return this.categories.list(admin);
  }

  @Get(':id')
  @ResponseMessage('Category loaded')
  get(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.get(admin, id);
  }

  @Patch(':id')
  @ResponseMessage('Category updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(admin, id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Category removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.categories.remove(admin, id);
  }
}
