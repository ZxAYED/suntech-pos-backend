import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
  StockTransactionType,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogOrderDto } from './dto/create-catalog-order.dto';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders.query';
import { ListOrdersQueryDto } from './dto/list-orders.query';
import { createInvoiceNumber } from './invoice-number';
import { lineTotal, sumMoney } from './money';
import { createReceiptNumber } from './receipt-number';
import { RefundStatus, refundStatus } from './refund-status';

export const orderLineSelect = {
  id: true,
  orderId: true,
  variantId: true,
  productName: true,
  variantName: true,
  quantity: true,
  unitPrice: true,
  subtotal: true,
} satisfies Prisma.OrderLineSelect;

export const unifiedOrderSelect = {
  id: true,
  invoiceNumber: true,
  receiptNumber: true,
  orderType: true,
  status: true,
  locationId: true,
  shiftId: true,
  cashierId: true,
  subtotal: true,
  totalAmount: true,
  tenderedAmount: true,
  changeDue: true,
  customerName: true,
  customerPhone: true,
  customerNumber: true,
  notes: true,
  paymentMethod: true,
  createdAt: true,
  updatedAt: true,
  lines: { select: orderLineSelect },
} satisfies Prisma.OrderSelect;

export type PresentedOrder = Prisma.OrderGetPayload<{
  select: typeof unifiedOrderSelect;
}>;

export interface ListedOrder {
  id: string;
  invoiceNumber?: string;
  receiptNumber: string;
  customerNumber: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  createdAt: Date;
  refundStatus: RefundStatus | null;
}

function getDateRange(
  range: 'today' | 'yesterday' | 'weekly' | 'monthly',
  now = new Date(),
): { gte: Date; lte?: Date } | undefined {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  if (range === 'today') {
    return { gte: startOfToday, lte: endOfToday };
  }
  if (range === 'yesterday') {
    const startOfYesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    const endOfYesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      23,
      59,
      59,
      999,
    );
    return { gte: startOfYesterday, lte: endOfYesterday };
  }
  if (range === 'weekly') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { gte: sevenDaysAgo };
  }
  if (range === 'monthly') {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte: thirtyDaysAgo };
  }
  return undefined;
}

const INVOICE_ATTEMPTS = 3;
const OPEN_SHIFT_REQUIRED = 'Open a shift before taking an order';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createCatalogOrder(
    actor: AccessTokenPayload | string,
    dto: CreateCatalogOrderDto,
  ): Promise<PresentedOrder> {
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Order must contain at least one line item',
      );
    }

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = createInvoiceNumber();
            return this.executeCatalogOrder(tx, actor, dto, invoiceNumber);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isUniqueConstraintError(error) &&
          this.targetsInvoice(error) &&
          attempt < INVOICE_ATTEMPTS
        ) {
          continue;
        }

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < INVOICE_ATTEMPTS) {
            continue;
          }
          throw new ConflictException(
            'Checkout could not be completed. Retry.',
          );
        }

        throw error;
      }
    }

    throw new ConflictException('Could not assign a unique invoice number');
  }

  private async resolveOrderExecutionContext(
    tx: Prisma.TransactionClient,
    actor: AccessTokenPayload | string,
    dto: { locationId?: string; shiftId?: string },
  ): Promise<{
    userId: string;
    businessId: string;
    locationId: string;
    shiftId: string | null;
  }> {
    const userId = typeof actor === 'string' ? actor : actor.sub;
    const actorRole = typeof actor === 'string' ? undefined : actor.role;
    const actorLocationId =
      typeof actor === 'string' ? undefined : actor.locationId;
    const actorBusinessId =
      typeof actor === 'string' ? undefined : actor.businessId;

    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { ownedBusiness: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const effectiveRole = actorRole ?? user.role;
    const effectiveBusinessId =
      actorBusinessId ?? user.businessId ?? user.ownedBusiness?.id;
    const effectiveLocationId = actorLocationId ?? user.locationId;

    if (effectiveRole !== Role.SUPER_ADMIN && !effectiveBusinessId) {
      throw new ForbiddenException('Create a business before creating orders');
    }

    let locationId = dto.locationId;
    if (effectiveRole === Role.CASHIER) {
      locationId = effectiveLocationId ?? dto.locationId;
      if (!locationId) {
        throw new ForbiddenException(
          'A cashier must be assigned to a location before creating orders',
        );
      }
      if (
        dto.locationId &&
        effectiveLocationId &&
        dto.locationId !== effectiveLocationId
      ) {
        throw new ForbiddenException(
          'Cashiers can only create orders for their assigned location',
        );
      }
    } else {
      if (!locationId) {
        locationId = effectiveLocationId ?? undefined;
      }
      if (!locationId) {
        throw new BadRequestException('Location ID is required');
      }
    }

    const location = await tx.location.findFirst({
      where: { id: locationId, deletedAt: null },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    if (effectiveBusinessId && location.businessId !== effectiveBusinessId) {
      throw new ForbiddenException('Location does not belong to your business');
    }

    const businessId = location.businessId;

    let shiftId = dto.shiftId ?? null;
    if (shiftId) {
      const shift = await tx.shiftSession.findFirst({
        where: { id: shiftId, businessId },
        select: { id: true, status: true, locationId: true, cashierId: true },
      });

      if (!shift) {
        throw new NotFoundException('Shift not found');
      }

      if (shift.status !== ShiftStatus.OPEN) {
        throw new ConflictException('Shift is already closed');
      }

      if (shift.locationId && shift.locationId !== locationId) {
        throw new ForbiddenException(
          'Shift does not belong to the selected location',
        );
      }

      if (
        effectiveRole === Role.CASHIER &&
        shift.cashierId &&
        shift.cashierId !== user.id
      ) {
        throw new ForbiddenException(
          'Cannot record orders under another cashier shift',
        );
      }
    } else if (effectiveRole === Role.CASHIER || user.role === Role.CASHIER) {
      const activeShift = await tx.shiftSession.findFirst({
        where: {
          businessId,
          cashierId: user.id,
          status: ShiftStatus.OPEN,
        },
        select: { id: true },
      });

      if (!activeShift) {
        throw new ConflictException(OPEN_SHIFT_REQUIRED);
      }
      shiftId = activeShift.id;
    }

    return {
      userId,
      businessId,
      locationId,
      shiftId,
    };
  }

  async executeCatalogOrder(
    tx: Prisma.TransactionClient,
    actor: AccessTokenPayload | string,
    dto: CreateCatalogOrderDto,
    invoiceNumber: string,
  ): Promise<PresentedOrder> {
    const { userId, businessId, locationId, shiftId } =
      await this.resolveOrderExecutionContext(tx, actor, dto);

    // 1. Validate Variants & Inventory
    const variantIds = [...new Set(dto.lines.map((l) => l.variantId))];
    const variants = await tx.variant.findMany({
      where: {
        id: { in: variantIds },
        businessId,
        deletedAt: null,
        product: {
          businessId,
          deletedAt: null,
        },
      },
      include: {
        product: { select: { name: true } },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const line of dto.lines) {
      const variant = variantMap.get(line.variantId);
      if (!variant) {
        throw new NotFoundException(`Variant not found: ${line.variantId}`);
      }
    }

    // Check stock for all requested variant quantities
    const requiredStock = new Map<string, number>();
    for (const line of dto.lines) {
      const current = requiredStock.get(line.variantId) ?? 0;
      requiredStock.set(line.variantId, current + line.quantity);
    }

    for (const [vId, totalQty] of requiredStock.entries()) {
      const variant = variantMap.get(vId)!;
      if (variant.stock < totalQty) {
        throw new BadRequestException(`Insufficient stock for variant ${vId}`);
      }
    }

    // 2. Compute Totals
    const preparedLines = dto.lines.map((line) => {
      const variant = variantMap.get(line.variantId)!;
      const unitPrice = variant.sellingPrice;
      const subtotal = lineTotal(unitPrice, line.quantity);

      return {
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name ?? null,
        unitPrice,
        quantity: line.quantity,
        subtotal,
      };
    });

    const subtotal = sumMoney(preparedLines.map((l) => l.subtotal));
    if (dto.tenderedAmount < subtotal) {
      throw new BadRequestException(
        `Tendered amount (${dto.tenderedAmount}) is less than total subtotal (${subtotal})`,
      );
    }
    const totalAmount = subtotal;
    const changeDue = dto.tenderedAmount - totalAmount;

    // 3. Database Transaction: stock decrement & transactions
    for (const [vId, totalQty] of requiredStock.entries()) {
      await tx.variant.update({
        where: { id: vId },
        data: { stock: { decrement: totalQty } },
      });

      await tx.stockTransaction.create({
        data: {
          variantId: vId,
          type: StockTransactionType.SALE,
          quantity: totalQty,
          notes: invoiceNumber,
        },
      });
    }

    const paymentMethod =
      dto.paymentMethod ?? dto.paymentType ?? PaymentMethod.COD;

    // Only COD orders increment physical drawer cash
    if (shiftId && paymentMethod === PaymentMethod.COD) {
      await tx.shiftSession.update({
        where: { id: shiftId },
        data: {
          cashCollected: { increment: totalAmount },
        },
      });
    }

    return tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        orderType: OrderType.CATALOG,
        status: OrderStatus.PAID,
        locationId,
        shiftId: shiftId ?? null,
        cashierId: userId,
        subtotal,
        totalAmount,
        tenderedAmount: dto.tenderedAmount,
        changeDue,
        customerName: dto.customerName?.trim() || null,
        customerPhone: dto.customerPhone?.trim() || null,
        customerNumber: dto.customerPhone?.trim() || null,
        notes: dto.notes?.trim() || null,
        paymentMethod,
        lines: {
          create: preparedLines,
        },
      },
      select: unifiedOrderSelect,
    });
  }

  async createCustomOrder(
    actor: AccessTokenPayload | string,
    dto: CreateCustomOrderDto,
  ): Promise<PresentedOrder> {
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Order must contain at least one line item',
      );
    }

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = createInvoiceNumber();
            return this.executeCustomOrder(tx, actor, dto, invoiceNumber);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isUniqueConstraintError(error) &&
          this.targetsInvoice(error) &&
          attempt < INVOICE_ATTEMPTS
        ) {
          continue;
        }

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < INVOICE_ATTEMPTS) {
            continue;
          }
          throw new ConflictException(
            'Checkout could not be completed. Retry.',
          );
        }

        throw error;
      }
    }

    throw new ConflictException('Could not assign a unique invoice number');
  }

  async executeCustomOrder(
    tx: Prisma.TransactionClient,
    actor: AccessTokenPayload | string,
    dto: CreateCustomOrderDto,
    invoiceNumber: string,
  ): Promise<PresentedOrder> {
    const { userId, businessId, locationId, shiftId } =
      await this.resolveOrderExecutionContext(tx, actor, dto);

    // 1. Bypass Catalog Lookup & Inventory:
    // Do NOT perform any database variant lookup.
    // Do NOT decrement or check stock levels.

    // 2. Compute Totals
    const preparedLines = dto.lines.map((line) => {
      const productName = line.productName.trim();
      if (!productName) {
        throw new BadRequestException('A custom item requires a product name');
      }
      const unitPrice = line.unitPrice;
      const subtotal = lineTotal(unitPrice, line.quantity);

      return {
        variantId: null,
        productName,
        variantName: line.variantName?.trim() || null,
        unitPrice,
        quantity: line.quantity,
        subtotal,
      };
    });

    const subtotal = sumMoney(preparedLines.map((l) => l.subtotal));
    if (dto.tenderedAmount < subtotal) {
      throw new BadRequestException(
        `Tendered amount (${dto.tenderedAmount}) is less than total subtotal (${subtotal})`,
      );
    }
    const totalAmount = subtotal;
    const changeDue = dto.tenderedAmount - totalAmount;
    const paymentMethod =
      dto.paymentMethod ?? dto.paymentType ?? PaymentMethod.COD;

    // 3. Database Transaction
    // Only COD orders increment physical drawer cash
    if (shiftId && paymentMethod === PaymentMethod.COD) {
      await tx.shiftSession.update({
        where: { id: shiftId },
        data: {
          cashCollected: { increment: totalAmount },
        },
      });
    }

    return tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        orderType: OrderType.CUSTOM,
        status: OrderStatus.PAID,
        locationId,
        shiftId: shiftId ?? null,
        cashierId: userId,
        subtotal,
        totalAmount,
        tenderedAmount: dto.tenderedAmount,
        changeDue,
        customerName: dto.customerName?.trim() || null,
        customerPhone: dto.customerPhone?.trim() || null,
        customerNumber: dto.customerPhone?.trim() || null,
        notes: dto.notes?.trim() || null,
        paymentMethod,
        lines: {
          create: preparedLines,
        },
      },
      select: unifiedOrderSelect,
    });
  }

  async getOrders(
    actorOrParams?: AccessTokenPayload | GetOrdersQueryDto,
    maybeQuery?: GetOrdersQueryDto,
  ): Promise<{
    items: PresentedOrder[];
    page: number;
    limit: number;
    total: number;
  }> {
    let actor: AccessTokenPayload | undefined;
    let query: GetOrdersQueryDto;

    if (actorOrParams && ('sub' in actorOrParams || 'role' in actorOrParams)) {
      actor = actorOrParams as AccessTokenPayload;
      query = maybeQuery ?? {};
    } else {
      query = (actorOrParams as GetOrdersQueryDto) ?? {};
    }

    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 20;

    const where: Prisma.OrderWhereInput = {};

    if (actor && actor.role !== Role.SUPER_ADMIN) {
      if (!actor.businessId) {
        throw new ForbiddenException('Create a business before continuing');
      }
      where.location = { businessId: actor.businessId };
    } else if (actor?.businessId) {
      where.location = { businessId: actor.businessId };
    }

    if (actor?.role === Role.CASHIER) {
      if (actor.locationId) {
        where.locationId = actor.locationId;
      }
    } else if (query.locationId) {
      where.locationId = query.locationId;
    }

    if (query.orderType) {
      where.orderType = query.orderType;
    }

    if (query.paymentMethod) {
      where.paymentMethod = query.paymentMethod;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.range) {
      const dateRange = getDateRange(query.range);
      if (dateRange) {
        where.createdAt = dateRange;
      }
    }

    if (query.search?.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
        { receiptNumber: { contains: searchTerm, mode: 'insensitive' } },
        { customerName: { contains: searchTerm, mode: 'insensitive' } },
        { customerPhone: { contains: searchTerm, mode: 'insensitive' } },
        { customerNumber: { contains: searchTerm, mode: 'insensitive' } },
        {
          lines: {
            some: {
              productName: { contains: searchTerm, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: unifiedOrderSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      page,
      limit,
      total,
    };
  }

  // Legacy checkout support
  async checkout(
    actor: AccessTokenPayload,
    dto: CreateOrderDto,
  ): Promise<PresentedOrder> {
    const businessId = requireBusinessId(actor);
    const location = await this.prisma.location.findFirst({
      where: { businessId, deletedAt: null },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException('No active location found for business');
    }

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            this.checkoutWithin(
              tx,
              actor,
              businessId,
              dto,
              createReceiptNumber(),
              location.id,
            ),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isUniqueConstraintError(error) &&
          this.targetsInvoice(error) &&
          attempt < INVOICE_ATTEMPTS
        ) {
          continue;
        }

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < INVOICE_ATTEMPTS) {
            continue;
          }
          throw new ConflictException(
            'Checkout could not be completed. Retry.',
          );
        }

        throw error;
      }
    }

    throw new ConflictException('Could not assign a receipt number');
  }

  async checkoutWithin(
    tx: Prisma.TransactionClient,
    actor: AccessTokenPayload,
    businessId: string,
    dto: CreateOrderDto,
    receiptNumber: string,
    fallbackLocationId?: string,
  ): Promise<PresentedOrder> {
    let shiftId: string | null = null;
    if (actor.role === Role.CASHIER) {
      const shift = await tx.shiftSession.findFirst({
        where: {
          businessId,
          cashierId: actor.sub,
          status: ShiftStatus.OPEN,
        },
        select: { id: true },
      });

      if (!shift) {
        throw new ConflictException(OPEN_SHIFT_REQUIRED);
      }
      shiftId = shift.id;
    }

    const locationId = actor.locationId ?? fallbackLocationId;
    if (!locationId) {
      throw new BadRequestException('Location ID is required');
    }

    const lines = [];

    for (const item of dto.items) {
      const variantId = item.variantId?.trim();

      if (variantId) {
        const variant = await tx.variant.findFirst({
          where: {
            id: variantId,
            businessId,
            deletedAt: null,
            product: { businessId, deletedAt: null },
          },
          include: { product: { select: { name: true } } },
        });

        if (!variant) {
          throw new NotFoundException('Variant not found');
        }

        if (variant.stock !== undefined && variant.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for variant ${variant.id}`,
          );
        }

        lines.push({
          variantId: variant.id,
          productName:
            (variant as any).product?.name ??
            (variant as any).name ??
            'Catalog Item',
          variantName: (variant as any).name ?? null,
          unitPrice: variant.sellingPrice,
          price: variant.sellingPrice,
          quantity: item.quantity,
          subtotal: lineTotal(variant.sellingPrice, item.quantity),
        });
        continue;
      }

      const customItemName = item.customItemName?.trim();

      if (!customItemName || item.price === undefined) {
        throw new BadRequestException('A custom item needs a name and a price');
      }

      lines.push({
        variantId: null,
        productName: customItemName,
        variantName: null,
        unitPrice: item.price,
        price: item.price,
        quantity: item.quantity,
        subtotal: lineTotal(item.price, item.quantity),
      });
    }

    for (const line of lines) {
      if (!line.variantId) {
        continue;
      }

      const decremented = await tx.variant.updateMany({
        where: { id: line.variantId, businessId },
        data: { stock: { decrement: line.quantity } },
      });

      if (decremented.count === 0) {
        throw new NotFoundException('Variant not found');
      }

      await tx.stockTransaction.create({
        data: {
          variantId: line.variantId,
          type: StockTransactionType.SALE,
          quantity: line.quantity,
          notes: receiptNumber,
        },
      });
    }

    const totalAmount = sumMoney(lines.map((line) => line.subtotal));

    if (shiftId && tx.shiftSession?.update) {
      await tx.shiftSession.update({
        where: { id: shiftId },
        data: {
          cashCollected: { increment: totalAmount },
        },
      });
    }

    return tx.order.create({
      data: {
        invoiceNumber: receiptNumber,
        receiptNumber,
        orderType: lines.some((l) => l.variantId)
          ? OrderType.CATALOG
          : OrderType.CUSTOM,
        status: OrderStatus.PAID,
        locationId,
        shiftId,
        cashierId: actor.sub,
        customerNumber: dto.customerNumber?.trim() || null,
        customerPhone: dto.customerNumber?.trim() || null,
        subtotal: totalAmount,
        totalAmount,
        tenderedAmount: totalAmount,
        changeDue: 0,
        paymentMethod: PaymentMethod.COD,
        lines: {
          create: lines.map((l) => ({
            variantId: l.variantId,
            productName: l.productName,
            variantName: l.variantName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
          })),
        },
      },
      select: unifiedOrderSelect,
    });
  }

  async list(
    actor: AccessTokenPayload,
    query: ListOrdersQueryDto,
  ): Promise<{
    items: ListedOrder[];
    page: number;
    limit: number;
    total: number;
  }> {
    const businessId = requireBusinessId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { cashier: { businessId } };
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          receiptNumber: true,
          customerName: true,
          customerPhone: true,
          customerNumber: true,
          totalAmount: true,
          paymentMethod: true,
          createdAt: true,
          lines: {
            select: {
              quantity: true,
              refundItems: { select: { quantity: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: orders.map((order) => ({
        id: order.id,
        invoiceNumber: order.invoiceNumber,
        receiptNumber: order.receiptNumber ?? order.invoiceNumber,
        customerNumber:
          order.customerNumber ?? order.customerPhone ?? order.customerName,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        refundStatus: refundStatus(
          order.lines.map((item) => ({
            quantity: item.quantity,
            refunded: item.refundItems.reduce(
              (totalRefunded, refund) => totalRefunded + refund.quantity,
              0,
            ),
          })),
        ),
      })),
      page,
      limit,
      total,
    };
  }

  private targetsInvoice(error: Prisma.PrismaClientKnownRequestError): boolean {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target : [target];

    return fields.some(
      (field) =>
        typeof field === 'string' &&
        (field.toLowerCase().includes('invoice') ||
          field.toLowerCase().includes('receipt')),
    );
  }
}

export { OrdersService as OrderService };
