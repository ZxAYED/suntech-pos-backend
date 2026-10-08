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
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductService } from './product.service';

@Controller('catalog/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
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
  @ResponseMessage('Products loaded')
  list(@CurrentUser() admin: AccessTokenPayload) {
    return this.products.list(admin);
  }

  @Get(':id')
  @ResponseMessage('Product loaded')
  get(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.products.get(admin, id);
  }

  @Patch(':id')
  @ResponseMessage('Product updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(admin, id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Product removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.products.remove(admin, id);
  }
}
