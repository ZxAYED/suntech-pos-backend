import {
  BadRequestException,
  ConflictException,
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

const INVOICE_ATTEMPTS = 3;
const OPEN_SHIFT_REQUIRED = 'Open a shift before taking an order';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createCatalogOrder(
    userId: string,
    dto: CreateCatalogOrderDto,
  ): Promise<PresentedOrder> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Order must contain at least one line item');
    }

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = createInvoiceNumber();
            return this.executeCatalogOrder(tx, userId, dto, invoiceNumber);
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
          throw new ConflictException(
            'Checkout could not be completed. Retry.',
          );
        }

        throw error;
      }
    }

    throw new ConflictException('Could not assign a unique invoice number');
  }

  async executeCatalogOrder(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateCatalogOrderDto,
    invoiceNumber: string,
  ): Promise<PresentedOrder> {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { ownedBusiness: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const location = await tx.location.findFirst({
      where: { id: dto.locationId, deletedAt: null },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const businessId = location.businessId;

    let shiftId = dto.shiftId;
    if (shiftId) {
      const shift = await tx.shiftSession.findFirst({
        where: { id: shiftId, businessId },
        select: { id: true, status: true },
      });

      if (!shift) {
        throw new NotFoundException('Shift not found');
      }

      if (shift.status !== ShiftStatus.OPEN) {
        throw new ConflictException('Shift is already closed');
      }
    } else if (user.role === Role.CASHIER) {
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

    // If shiftId is present, increment the shift's cash collected totals
    if (shiftId) {
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
        locationId: dto.locationId,
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
        paymentMethod: dto.paymentMethod ?? dto.paymentType ?? PaymentMethod.COD,
        lines: {
          create: preparedLines,
        },
      },
      select: unifiedOrderSelect,
    });
  }

  async createCustomOrder(
    userId: string,
    dto: CreateCustomOrderDto,
  ): Promise<PresentedOrder> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Order must contain at least one line item');
    }

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = createInvoiceNumber();
            return this.executeCustomOrder(tx, userId, dto, invoiceNumber);
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
    userId: string,
    dto: CreateCustomOrderDto,
    invoiceNumber: string,
  ): Promise<PresentedOrder> {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { ownedBusiness: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const location = await tx.location.findFirst({
      where: { id: dto.locationId, deletedAt: null },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const businessId = location.businessId;

    let shiftId = dto.shiftId;
    if (shiftId) {
      const shift = await tx.shiftSession.findFirst({
        where: { id: shiftId, businessId },
        select: { id: true, status: true },
      });

      if (!shift) {
        throw new NotFoundException('Shift not found');
      }

      if (shift.status !== ShiftStatus.OPEN) {
        throw new ConflictException('Shift is already closed');
      }
    } else if (user.role === Role.CASHIER) {
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

    // 3. Database Transaction
    // If shiftId is present, increment the shift's cash collected totals so the physical cash drawer balances during shift close
    if (shiftId) {
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
        locationId: dto.locationId,
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
        paymentMethod: dto.paymentMethod ?? dto.paymentType ?? PaymentMethod.COD,
        lines: {
          create: preparedLines,
        },
      },
      select: unifiedOrderSelect,
    });
  }

  async getOrders(params: {
    locationId?: string;
    orderType?: 'CATALOG' | 'CUSTOM';
    page?: number;
    limit?: number;
  }): Promise<{
    items: PresentedOrder[];
    page: number;
    limit: number;
    total: number;
  }> {
    const page = params.page ? Number(params.page) : 1;
    const limit = params.limit ? Number(params.limit) : 20;

    const where: Prisma.OrderWhereInput = {};
    if (params.locationId) {
      where.locationId = params.locationId;
    }
    if (params.orderType) {
      where.orderType = params.orderType;
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

        lines.push({
          variantId: variant.id,
          productName: (variant as any).product?.name ?? (variant as any).name ?? 'Catalog Item',
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
