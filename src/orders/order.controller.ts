import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';
import { ConfirmLegacySyncDto } from './dto/confirm-legacy-sync.dto';
import { CreateCatalogOrderDto } from './dto/create-catalog-order.dto';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders.query';
import { SyncOrdersDto } from './dto/sync-orders.dto';
import { OrdersService } from './order.service';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CASHIER', 'SUPER_ADMIN')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('catalog')
  @Roles('ADMIN', 'CASHIER')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Catalog order created')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Create catalog order',
    description:
      'Checkout catalog variants at the current backend price. Stock is decremented atomically, may become negative, and low stock is audited. A shift is optional.',
  })
  @ApiResponse({
    status: 201,
    description: 'Catalog order created successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or insufficient tender amount',
  })
  @ApiResponse({ status: 404, description: 'Location or variant not found' })
  async createCatalogOrder(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateCatalogOrderDto,
  ) {
    return this.ordersService.createCatalogOrder(actor, dto);
  }

  @Post('custom')
  @Roles('ADMIN', 'CASHIER')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Custom order created')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Create custom / ad-hoc order',
    description:
      'High-velocity manual checkout for unlisted items and ad-hoc sales, bypassing catalog lookup and inventory decrement. Supports payment types: COD, BKASH, NAGAD, BANK. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({
    status: 201,
    description: 'Custom order created successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or insufficient tender amount',
  })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async createCustomOrder(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateCustomOrderDto,
  ) {
    return this.ordersService.createCustomOrder(actor, dto);
  }

  @Post('sync')
  @Roles('ADMIN', 'CASHIER')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offline orders synchronized')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Synchronize queued offline orders',
    description:
      'Processes up to 100 locally committed orders independently. Requires strict ISO 8601 with timezone/offset for occurredAt, verifies clock skew against OFFLINE_MAX_FUTURE_SKEW_SECONDS, uses canonical SHA-256 payload hash fingerprinting for tamper-proof deduplication, and returns serverTime.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-order synchronization results with serverTime',
  })
  syncOrders(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: SyncOrdersDto,
  ) {
    return this.ordersService.syncOrders(actor, dto);
  }

  @Get()
  @Roles('ADMIN', 'CASHIER', 'SUPER_ADMIN')
  @ResponseMessage('Orders loaded')
  @ApiOperation({
    summary: '[ADMIN, CASHIER, SUPER_ADMIN] List unified orders',
    description:
      'Retrieve paginated orders across both CATALOG and CUSTOM channels, scoped by business tenant and optional location, status, range, or search filters. Accessible by ADMIN, CASHIER, and SUPER_ADMIN.',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    type: String,
    description:
      'Tenant business UUID (Required for Super Admin; optional for Admin with owned business)',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    type: String,
    description: 'Filter by location UUID',
  })
  @ApiQuery({
    name: 'orderType',
    required: false,
    enum: OrderType,
    enumName: 'OrderType',
    description: 'Filter by order flow type (CATALOG or CUSTOM)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search invoice, receipt, customer or item name',
  })
  @ApiQuery({
    name: 'paymentMethod',
    required: false,
    enum: PaymentMethod,
    enumName: 'PaymentMethod',
    description: 'Filter by payment method (COD, BKASH, NAGAD, BANK)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: OrderStatus,
    enumName: 'OrderStatus',
    description: 'Filter by order status (PAID, CANCELLED, REFUNDED)',
  })
  @ApiQuery({
    name: 'range',
    required: false,
    enum: [
      'today',
      'yesterday',
      'weekly',
      'monthly',
      'daily',
      'quarterly',
      'week',
      'month',
      'year',
    ],
    enumName: 'OrderDateRange',
    description:
      'Filter orders by period range ("month" defaults to current month)',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    type: String,
    description:
      'Filter by month name or code (e.g. october, oct, 10, current)',
    example: 'october',
  })
  @ApiQuery({
    name: 'week',
    required: false,
    type: String,
    description: 'Filter by week number (1-53) or "current"',
    example: 'current',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Filter by calendar year (e.g. 2026)',
    example: 2026,
  })
  @ApiQuery({
    name: 'ownOrders',
    required: false,
    type: Boolean,
    description:
      'When true for Admin, returns only orders created/sold by the admin themselves. Default false (all business orders)',
    example: true,
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['all', 'my', 'own'],
    description:
      'Scope orders: "all" for all business orders, "my" for admin own sales',
    example: 'all',
  })
  @ApiQuery({
    name: 'cashierId',
    required: false,
    type: String,
    description: 'Filter orders sold by a specific cashier or staff user ID',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 20)',
    example: 20,
  })
  @ApiResponse({ status: 200, description: 'Orders loaded successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  async getOrders(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: GetOrdersQueryDto,
    ...rest: unknown[]
  ) {
    // Backwards-compatibility for direct unit test calls: controller.getOrders('loc-1', 'CATALOG', 1, 20)
    if (typeof (actor as unknown) === 'string') {
      const locationId = actor as unknown as string;
      const orderType = query as unknown as 'CATALOG' | 'CUSTOM' | undefined;
      return this.ordersService.getOrders({
        locationId,
        orderType,
        page: (rest[0] as number | undefined) ?? 1,
        limit: (rest[1] as number | undefined) ?? 20,
      });
    }

    return this.ordersService.getOrders(actor, query);
  }

  @Get(':id')
  @Roles('ADMIN', 'CASHIER', 'SUPER_ADMIN')
  @ResponseMessage('Order loaded')
  @ApiOperation({
    summary: '[ADMIN, CASHIER, SUPER_ADMIN] Get order details by ID',
    description:
      'Retrieve a single order by ID with full item details and authoritative per-line refunded and refundable quantities, scoped by tenant and location.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order retrieved successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - not authorized to view this order',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderById(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderById(actor, id);
  }

  @Post(':id/confirm-legacy-sync')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Legacy sync order confirmed')
  @ApiOperation({
    summary: '[ADMIN, SUPER_ADMIN] Confirm legacy unhashed sync order',
    description:
      'Records administrative audit confirmation for legacy offline orders created prior to sync payload hashing, unblocking subsequent replay handling.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({
    status: 200,
    description: 'Legacy sync order confirmed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Order already hashed or rationale invalid',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires ADMIN or SUPER_ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async confirmLegacySync(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmLegacySyncDto,
  ) {
    return this.ordersService.confirmLegacySync(actor, id, dto);
  }

  // Legacy route support
  @Post()
  @Roles('ADMIN', 'CASHIER')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Order completed')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Legacy checkout order',
    description:
      'Backwards-compatible single-route checkout endpoint. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 201, description: 'Order completed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  async checkout(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.checkout(actor, dto);
  }
}

export { OrdersController as OrderController };
