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
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { VariantService } from './variant.service';

@Controller('catalog/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class VariantController {
  constructor(private readonly variants: VariantService) {}

  @Post()
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
  @ResponseMessage('Variants loaded')
  list(@CurrentUser() admin: AccessTokenPayload) {
    return this.variants.list(admin);
  }

  @Get(':id')
  @ResponseMessage('Variant loaded')
  get(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.get(admin, id);
  }

  @Patch(':id')
  @ResponseMessage('Variant updated')
  update(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variants.update(admin, id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Variant removed')
  remove(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.variants.remove(admin, id);
  }
}
