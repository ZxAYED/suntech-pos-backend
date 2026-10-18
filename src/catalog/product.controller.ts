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
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

@Controller('catalog/products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @Roles(Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Product created')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(admin, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Products loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.products.list(actor, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Product loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.products.get(actor, id);
  }

  @Patch(':id')
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
  @Roles(Role.ADMIN)
  @ResponseMessage('Product removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.products.remove(admin, id);
  }
}
