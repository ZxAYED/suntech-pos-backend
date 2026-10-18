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
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants.query';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { VariantService } from './variant.service';

@Controller('catalog/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VariantController {
  constructor(private readonly variants: VariantService) {}

  @Post()
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
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Variants loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListVariantsQueryDto,
  ) {
    return this.variants.list(actor, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Variant loaded')
  get(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.get(actor, id);
  }

  @Patch(':id')
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
  @Roles(Role.ADMIN)
  @ResponseMessage('Variant removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.remove(admin, id);
  }
}
