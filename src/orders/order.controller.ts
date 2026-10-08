import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateCatalogOrderDto } from './dto/create-catalog-order.dto';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query';
import { OrdersService } from './order.service';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CASHIER', 'SUPER_ADMIN')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('catalog')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Catalog order created')
  @ApiOperation({
    summary: 'Create catalog order',
    description:
      'Checkout enlisted catalog variants with inventory validation and stock decrement. Supports payment types: COD, BKASH, NAGAD, BANK.',
  })
  @ApiResponse({ status: 201, description: 'Catalog order created successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed or insufficient tender amount' })
  @ApiResponse({ status: 404, description: 'Location, shift, or catalog variant not found' })
  @ApiResponse({ status: 409, description: 'Insufficient variant stock or closed shift' })
  async createCatalogOrder(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCatalogOrderDto,
  ) {
    return this.ordersService.createCatalogOrder(userId, dto);
  }

  @Post('custom')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Custom order created')
  @ApiOperation({
    summary: 'Create custom / ad-hoc order',
    description:
      'High-velocity manual checkout for unlisted items and ad-hoc sales, bypassing catalog lookup and inventory decrement. Supports payment types: COD, BKASH, NAGAD, BANK.',
  })
  @ApiResponse({ status: 201, description: 'Custom order created successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed or insufficient tender amount' })
  @ApiResponse({ status: 404, description: 'Location or shift not found' })
  @ApiResponse({ status: 409, description: 'Shift requirement conflict or closed shift' })
  async createCustomOrder(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCustomOrderDto,
  ) {
    return this.ordersService.createCustomOrder(userId, dto);
  }

  @Get()
  @ResponseMessage('Orders loaded')
  @ApiOperation({
    summary: 'List unified orders',
    description:
      'Retrieve paginated orders across both CATALOG and CUSTOM channels, optionally filtered by location and/or orderType.',
  })
  @ApiQuery({ name: 'locationId', required: false, type: String, description: 'Filter by location UUID' })
  @ApiQuery({ name: 'orderType', required: false, enum: ['CATALOG', 'CUSTOM'], description: 'Filter by order flow type' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20)', example: 20 })
  @ApiResponse({ status: 200, description: 'Orders loaded successfully' })
  async getOrders(
    @Query('locationId') locationId?: string,
    @Query('orderType') orderType?: 'CATALOG' | 'CUSTOM',
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.ordersService.getOrders({ locationId, orderType, page, limit });
  }

  // Legacy route support
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Order completed')
  @ApiOperation({
    summary: 'Legacy checkout order',
    description: 'Backwards-compatible single-route checkout endpoint.',
  })
  @ApiResponse({ status: 201, description: 'Order completed' })
  async checkout(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.checkout(actor, dto);
  }
}

export { OrdersController as OrderController };

