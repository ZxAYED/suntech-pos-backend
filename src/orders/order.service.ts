import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
import { resolveDhakaDateRange } from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogOrderDto } from './dto/create-catalog-order.dto';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders.query';
import { ListOrdersQueryDto } from './dto/list-orders.query';
import { SyncOrderItemDto, SyncOrdersDto } from './dto/sync-orders.dto';
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
  categoryName: true,
  unitCost: true,
  quantity: true,
  unitPrice: true,
  subtotal: true,
  refundItems: {
    select: {
      id: true,
      quantity: true,
      refundAmount: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderLineSelect;

export const unifiedOrderSelect = {
  id: true,
  invoiceNumber: true,
  receiptNumber: true,
  clientOrderId: true,
  clientReceiptNumber: true,
  deviceId: true,
  orderType: true,
  status: true,
  locationId: true,
  shiftId: true,
  cashierId: true,
  cashier: {
    select: {
      id: true,
      fullName: true,
      role: true,
    },
  },
  subtotal: true,
  totalAmount: true,
  tenderedAmount: true,
  changeDue: true,
  customerName: true,
  customerPhone: true,
  customerNumber: true,
  notes: true,
  paymentMethod: true,
  occurredAt: true,
  createdAt: true,
  updatedAt: true,
  lines: { select: orderLineSelect },
} satisfies Prisma.OrderSelect;

export type RawOrderLine = Prisma.OrderLineGetPayload<{
  select: typeof orderLineSelect;
}>;

export type PresentedOrderLine = RawOrderLine & {
  refundedQuantity: number;
  refundableQuantity: number;
  refundedAmount: number;
};

export type PresentedOrder = Omit<
  Prisma.OrderGetPayload<{
    select: typeof unifiedOrderSelect;
  }>,
  'lines'
> & {
  lines: PresentedOrderLine[];
  totalRefundedAmount?: number;
};

export function presentOrderLine(line: RawOrderLine): PresentedOrderLine {
  const refundedQuantity = (line.refundItems ?? []).reduce(
    (sum, item) => sum + (item.quantity ?? 0),
    0,
  );
  const refundedAmount = (line.refundItems ?? []).reduce(
    (sum, item) => sum + (item.refundAmount ?? 0),
    0,
  );
  const refundableQuantity = Math.max(0, line.quantity - refundedQuantity);

  return {
    ...line,
    refundedQuantity,
    refundableQuantity,
    refundedAmount,
  };
}

export function presentOrder(
  order: any,
): PresentedOrder {
  if (!order) return order as unknown as PresentedOrder;
  const rawLines = Array.isArray(order.lines) ? order.lines : [];
  const lines = rawLines.map(presentOrderLine);
  const totalRefundedAmount = lines.reduce(
    (sum: number, line: PresentedOrderLine) => sum + (line.refundedAmount ?? 0),
    0,
  );
  return {
    ...order,
    lines,
    totalRefundedAmount,
  };
}

export interface ListedOrder {
  id: string;
  invoiceNumber?: string;
  receiptNumber: string;
  customerNumber: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  occurredAt: Date;
  createdAt: Date;
  refundStatus: RefundStatus | null;
}

const INVOICE_ATTEMPTS = 3;
const LOW_STOCK_THRESHOLD = 5;

type OfflineOrderOptions = {
  clientOrderId: string;
  clientReceiptNumber?: string;
  deviceId: string;
  occurredAt: Date;
  warnings: string[];
};

type CatalogOrderInput = Omit<CreateCatalogOrderDto, 'lines'> & {
  lines: Array<
    CreateCatalogOrderDto['lines'][number] & {
      productName?: string;
      variantName?: string;
      categoryName?: string;
    }
  >;
};

export type SyncOrderResult = {
  clientOrderId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  orderId?: string;
  invoiceNumber?: string;
  warnings: string[];
  error?: string;
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createCatalogOrder(
    actor: AccessTokenPayload | string,
    dto: CatalogOrderInput,
    options?: OfflineOrderOptions,
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
            return this.executeCatalogOrder(
              tx,
              actor,
              dto,
              invoiceNumber,
              options,
            );
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
    dto: { businessId?: string; locationId?: string; shiftId?: string },
    warnings?: string[],
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
      include: {
        ownedBusinesses: {
          where: { deletedAt: null },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const effectiveRole = actorRole ?? user.role;
    const requestedBusinessId = dto.businessId;
    const ownedBusinessIds = new Set(
      (user.ownedBusinesses ?? []).map((business) => business.id),
    );
    if (!user.ownedBusinesses && actorBusinessId) {
      ownedBusinessIds.add(actorBusinessId);
    }
    const effectiveBusinessId =
      effectiveRole === Role.CASHIER
        ? (actorBusinessId ?? user.businessId)
        : (requestedBusinessId ?? actorBusinessId ?? user.businessId);
    const effectiveLocationId = actorLocationId ?? user.locationId;

    if (!effectiveBusinessId) {
      throw new BadRequestException(
        'businessId is required for Admin checkout',
      );
    }
    if (
      effectiveRole === Role.ADMIN &&
      !ownedBusinessIds.has(effectiveBusinessId)
    ) {
      throw new ForbiddenException('You do not have access to this business');
    }

    let locationId: string | undefined;
    if (effectiveRole === Role.CASHIER) {
      if (dto.businessId && dto.businessId !== effectiveBusinessId) {
        throw new ForbiddenException(
          'Cashiers cannot override business context',
        );
      }
      locationId = effectiveLocationId ?? undefined;
      if (!locationId) {
        throw new ForbiddenException(
          'A cashier must be assigned to a location before creating orders',
        );
      }
    } else {
      locationId = dto.locationId;
      if (!locationId) {
        throw new BadRequestException(
          'locationId is required for Admin checkout',
        );
      }
    }

    const location = await tx.location.findFirst({
      where: {
        id: locationId,
        businessId: effectiveBusinessId,
        deletedAt: null,
      },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    if (effectiveBusinessId && location.businessId !== effectiveBusinessId) {
      throw new ForbiddenException('Location does not belong to your business');
    }

    const businessId = location.businessId;

    let shiftId: string | null = null;
    if (dto.shiftId) {
      const shift = await tx.shiftSession.findFirst({
        where: { id: dto.shiftId, businessId },
        select: { id: true, status: true, locationId: true, cashierId: true },
      });

      const canAttach =
        shift?.status === ShiftStatus.OPEN &&
        (!shift.locationId || shift.locationId === locationId) &&
        (effectiveRole !== Role.CASHIER ||
          !shift.cashierId ||
          shift.cashierId === user.id);
      if (canAttach) {
        shiftId = shift.id;
      } else {
        this.addWarning(warnings, 'SHIFT_NOT_ATTACHED');
      }
    } else {
      const activeShift = await tx.shiftSession.findFirst({
        where: {
          businessId,
          cashierId: userId,
          locationId,
          status: ShiftStatus.OPEN,
        },
        orderBy: { openedAt: 'desc' },
        select: { id: true },
      });

      if (activeShift) {
        shiftId = activeShift.id;
      } else {
        this.addWarning(warnings, 'SHIFT_NOT_ATTACHED');
      }
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
    dto: CatalogOrderInput,
    invoiceNumber: string,
    options?: OfflineOrderOptions,
  ): Promise<PresentedOrder> {
    const { userId, businessId, locationId, shiftId } =
      await this.resolveOrderExecutionContext(
        tx,
        actor,
        dto,
        options?.warnings,
      );

    // 1. Validate Variants & Inventory
    const variantIds = [
      ...new Set(dto.lines.map((line) => line.variantId).filter(Boolean)),
    ];
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
        product: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
        locationStocks: {
          where: { locationId },
          select: { id: true, stock: true },
        },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const unavailableLines: CatalogOrderInput['lines'] = [];
    const requiredStock = new Map<string, number>();
    for (const line of dto.lines) {
      const variant = variantMap.get(line.variantId);
      if (!variant) {
        if (!options) {
          throw new NotFoundException(`Variant not found: ${line.variantId}`);
        }
        unavailableLines.push(line);
        this.addWarning(options.warnings, 'VARIANT_UNAVAILABLE');
        continue;
      }
      const current = requiredStock.get(line.variantId) ?? 0;
      requiredStock.set(line.variantId, current + line.quantity);
    }

    // 2. Compute Totals
    const preparedLines = dto.lines.map((line) => {
      const variant = variantMap.get(line.variantId);
      const unitPrice = options ? line.unitPrice : variant!.sellingPrice;
      const subtotal = lineTotal(unitPrice, line.quantity);

      if (options && variant && unitPrice !== variant.sellingPrice) {
        this.addWarning(options.warnings, 'OFFLINE_PRICE_MISMATCH');
      }

      return {
        variantId: variant?.id ?? null,
        productName:
          variant?.product.name ??
          line.productName?.trim() ??
          'Unavailable Catalog Item',
        variantName: variant?.name ?? line.variantName?.trim() ?? null,
        unitPrice,
        unitCost: variant?.costPrice ?? null,
        categoryName:
          variant?.product.category?.name ??
          line.categoryName?.trim() ??
          'Uncategorized',
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

    // 3. Database Transaction: stock decrement & transactions. Stock may go
    // below zero because delayed offline sales must never disappear.
    const stockResults: Array<{
      variantId: string;
      previousStock: number;
      quantity: number;
      resultingStock: number;
    }> = [];
    for (const [vId, totalQty] of requiredStock.entries()) {
      const variant = variantMap.get(vId)!;
      const locStock = variant.locationStocks?.[0];
      const previousStock = locStock?.stock ?? 0;
      let resultingStock = previousStock - totalQty;

      if (locStock) {
        const updated = await tx.locationStock.update({
          where: { id: locStock.id },
          data: { stock: { decrement: totalQty } },
          select: { stock: true },
        });
        resultingStock = updated.stock;
      } else {
        const updated = await tx.locationStock.upsert({
          where: {
            locationId_variantId: { locationId, variantId: vId },
          },
          update: { stock: { decrement: totalQty } },
          create: {
            businessId,
            locationId,
            variantId: vId,
            stock: -totalQty,
          },
          select: { stock: true },
        });
        resultingStock = updated.stock;
      }

      await tx.variant.update({
        where: { id: vId },
        data: { stock: { decrement: totalQty } },
      });

      await tx.stockTransaction.create({
        data: {
          variantId: vId,
          locationId: locationId ?? null,
          type: StockTransactionType.SALE,
          quantity: totalQty,
          notes: invoiceNumber,
        },
      });

      stockResults.push({
        variantId: vId,
        previousStock,
        quantity: totalQty,
        resultingStock,
      });
    }

    const paymentMethod =
      dto.paymentMethod ?? dto.paymentType ?? PaymentMethod.COD;
    if (!Object.values(PaymentMethod).includes(paymentMethod)) {
      throw new BadRequestException(
        'Explicit payment method is required: COD, BKASH, NAGAD, BANK',
      );
    }

    // Only COD orders increment physical drawer cash
    if (shiftId && paymentMethod === PaymentMethod.COD) {
      await tx.shiftSession.update({
        where: { id: shiftId },
        data: {
          cashCollected: { increment: totalAmount },
        },
      });
    }

    const order = await tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        clientOrderId: options?.clientOrderId,
        clientReceiptNumber: options?.clientReceiptNumber,
        deviceId: options?.deviceId,
        occurredAt: options?.occurredAt ?? new Date(),
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

    for (const stock of stockResults) {
      if (stock.resultingStock <= LOW_STOCK_THRESHOLD) {
        this.addWarning(options?.warnings, 'LOW_STOCK_AFTER_SALE');
        await tx.auditLog.create({
          data: {
            actorId: userId,
            businessId,
            locationId,
            action: 'LOW_STOCK_AFTER_SALE',
            entityType: 'VARIANT',
            entityId: stock.variantId,
            metadata: {
              orderId: order.id,
              invoiceNumber,
              variantId: stock.variantId,
              locationId,
              previousStock: stock.previousStock,
              quantitySold: stock.quantity,
              resultingStock: stock.resultingStock,
              deviceId: options?.deviceId ?? null,
            },
          },
        });
      }
    }

    if (options) {
      for (const line of dto.lines) {
        const variant = variantMap.get(line.variantId);
        if (variant && line.unitPrice !== variant.sellingPrice) {
          await tx.auditLog.create({
            data: {
              actorId: userId,
              businessId,
              locationId,
              action: 'OFFLINE_PRICE_MISMATCH',
              entityType: 'VARIANT',
              entityId: variant.id,
              metadata: {
                orderId: order.id,
                invoiceNumber,
                variantId: variant.id,
                locationId,
                currentSellingPrice: variant.sellingPrice,
                chargedUnitPrice: line.unitPrice,
                unitPriceDifference: line.unitPrice - variant.sellingPrice,
                quantity: line.quantity,
                deviceId: options.deviceId,
                occurredAt: order.occurredAt,
                synchronizedAt: order.createdAt,
              },
            },
          });
        }
      }

      for (const line of unavailableLines) {
        await tx.auditLog.create({
          data: {
            actorId: userId,
            businessId,
            locationId,
            action: 'VARIANT_UNAVAILABLE',
            entityType: 'VARIANT',
            entityId: line.variantId,
            metadata: {
              orderId: order.id,
              invoiceNumber,
              variantId: line.variantId,
              locationId,
              productName: line.productName ?? null,
              variantName: line.variantName ?? null,
              chargedUnitPrice: line.unitPrice,
              quantity: line.quantity,
              deviceId: options.deviceId,
            },
          },
        });
      }
    }

    return presentOrder(order);
  }

  async createCustomOrder(
    actor: AccessTokenPayload | string,
    dto: CreateCustomOrderDto,
    options?: OfflineOrderOptions,
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
            return this.executeCustomOrder(
              tx,
              actor,
              dto,
              invoiceNumber,
              options,
            );
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
    options?: OfflineOrderOptions,
  ): Promise<PresentedOrder> {
    const { userId, locationId, shiftId } =
      await this.resolveOrderExecutionContext(
        tx,
        actor,
        dto,
        options?.warnings,
      );

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
        unitCost: null,
        categoryName: 'Uncategorized',
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
    if (!Object.values(PaymentMethod).includes(paymentMethod)) {
      throw new BadRequestException(
        'Explicit payment method is required: COD, BKASH, NAGAD, BANK',
      );
    }

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

    const order = await tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        clientOrderId: options?.clientOrderId,
        clientReceiptNumber: options?.clientReceiptNumber,
        deviceId: options?.deviceId,
        occurredAt: options?.occurredAt ?? new Date(),
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

    return presentOrder(order);
  }

  async syncOrders(
    actor: AccessTokenPayload,
    dto: SyncOrdersDto,
  ): Promise<{ results: SyncOrderResult[] }> {
    const syncActor =
      actor.role === Role.CASHIER
        ? actor
        : { ...actor, businessId: dto.businessId, locationId: dto.locationId };
    if (
      actor.role === Role.CASHIER &&
      ((dto.businessId && dto.businessId !== actor.businessId) ||
        (dto.locationId && dto.locationId !== actor.locationId))
    ) {
      throw new ForbiddenException(
        'Cashiers cannot override synchronization context',
      );
    }
    if (!syncActor.businessId || !syncActor.locationId) {
      throw new ForbiddenException(
        'Offline synchronization requires business and location in the access token',
      );
    }

    const results: SyncOrderResult[] = [];
    for (const rawOrder of dto.orders) {
      const clientOrderId =
        typeof rawOrder?.clientOrderId === 'string'
          ? rawOrder.clientOrderId
          : '';
      const item = plainToInstance(SyncOrderItemDto, rawOrder);
      const validationErrors = await validate(item, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      if (validationErrors.length > 0) {
        results.push({
          clientOrderId,
          status: 'REJECTED',
          warnings: [],
          error: this.validationMessage(validationErrors),
        });
        continue;
      }

      const shapeError = this.validateSyncOrderShape(item);
      if (shapeError) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          warnings: [],
          error: shapeError,
        });
        continue;
      }

      const duplicate = this.prisma.order.findFirst
        ? await this.prisma.order.findFirst({
            where: {
              clientOrderId: item.clientOrderId,
              locationId: syncActor.locationId,
              cashier: { businessId: syncActor.businessId },
            },
            select: { id: true, invoiceNumber: true },
          })
        : await this.prisma.order.findUnique({
            where: { clientOrderId: item.clientOrderId },
            select: { id: true, invoiceNumber: true },
          });
      if (duplicate) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'DUPLICATE',
          orderId: duplicate.id,
          invoiceNumber: duplicate.invoiceNumber,
          warnings: [],
        });
        continue;
      }

      const foreignDuplicate = (this.prisma.order as any).findFirst
        ? await this.prisma.order.findUnique({
            where: { clientOrderId: item.clientOrderId },
            select: { id: true },
          })
        : null;
      if (foreignDuplicate) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          warnings: [],
          error: 'clientOrderId is already used in another business or location',
        });
        continue;
      }

      const warnings: string[] = [];
      const options: OfflineOrderOptions = {
        clientOrderId: item.clientOrderId,
        clientReceiptNumber: item.clientReceiptNumber,
        deviceId: dto.deviceId,
        occurredAt: new Date(item.occurredAt),
        warnings,
      };

      try {
        const common = {
          shiftId: item.shiftId,
          tenderedAmount: item.tenderedAmount,
          paymentMethod: item.paymentMethod ?? PaymentMethod.COD,
          customerName: item.customerName,
          customerPhone: item.customerPhone,
          notes: item.notes,
        };
        const order =
          item.orderType === OrderType.CATALOG
            ? await this.createCatalogOrder(
                syncActor,
                {
                  ...common,
                  lines: item.lines.map((line) => ({
                    variantId: line.variantId!,
                    productName: line.productName,
                    variantName: line.variantName,
                    categoryName: line.categoryName,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                  })),
                },
                options,
              )
            : await this.createCustomOrder(
                syncActor,
                {
                  ...common,
                  lines: item.lines.map((line) => ({
                    productName: line.productName!,
                    variantName: line.variantName,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                  })),
                },
                options,
              );

        results.push({
          clientOrderId: item.clientOrderId,
          status: 'ACCEPTED',
          orderId: order.id,
          invoiceNumber: order.invoiceNumber,
          warnings,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const existing = (this.prisma.order as any).findFirst
            ? await this.prisma.order.findFirst({
                where: {
                  clientOrderId: item.clientOrderId,
                  locationId: syncActor.locationId,
                  cashier: { businessId: syncActor.businessId },
                },
                select: { id: true, invoiceNumber: true },
              })
            : await this.prisma.order.findUnique({
                where: { clientOrderId: item.clientOrderId },
                select: { id: true, invoiceNumber: true },
              });
          if (existing) {
            results.push({
              clientOrderId: item.clientOrderId,
              status: 'DUPLICATE',
              orderId: existing.id,
              invoiceNumber: existing.invoiceNumber,
              warnings: [],
            });
            continue;
          }
        }

        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          warnings,
          error: this.syncErrorMessage(error),
        });
      }
    }

    return { results };
  }

  private validateSyncOrderShape(item: SyncOrderItemDto): string | null {
    if (new Date(item.occurredAt).getTime() > Date.now()) {
      return 'occurredAt must not be in the future';
    }
    if (item.orderType === OrderType.CATALOG) {
      return item.lines.some((line) => !line.variantId)
        ? 'Every catalog line requires variantId'
        : null;
    }
    if (item.orderType === OrderType.CUSTOM) {
      return item.lines.some((line) => !line.productName?.trim())
        ? 'Every custom line requires productName'
        : null;
    }
    return 'Unsupported orderType';
  }

  private validationMessage(
    errors: Awaited<ReturnType<typeof validate>>,
  ): string {
    const messages: string[] = [];
    const visit = (error: (typeof errors)[number], prefix = '') => {
      const field = prefix ? `${prefix}.${error.property}` : error.property;
      if (error.constraints) {
        messages.push(
          ...Object.values(error.constraints).map((m) => `${field}: ${m}`),
        );
      }
      error.children?.forEach((child) => visit(child, field));
    };
    errors.forEach((error) => visit(error));
    return messages.join('; ') || 'Malformed order';
  }

  private addWarning(warnings: string[] | undefined, warning: string): void {
    if (warnings && !warnings.includes(warning)) {
      warnings.push(warning);
    }
  }

  private syncErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = response.message;
        return Array.isArray(message) ? message.join('; ') : String(message);
      }
    }
    return error instanceof Error
      ? error.message
      : 'Order synchronization failed';
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

    const isOwnOrders =
      query.ownOrders === true ||
      (query.ownOrders as unknown as string) === 'true' ||
      query.scope === 'my' ||
      query.scope === 'own';

    if (actor && actor.role === Role.CASHIER) {
      if (!actor.businessId || !actor.locationId) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
      where.location = { businessId: actor.businessId };
      where.locationId = actor.locationId;
      if (isOwnOrders) {
        where.cashierId = actor.sub;
      }
    } else if (actor && actor.role === Role.ADMIN) {
      let resolvedBiz = query.businessId?.trim() || actor.businessId;
      if (!resolvedBiz) {
        if (actor.businessIds && actor.businessIds.length === 1) {
          resolvedBiz = actor.businessIds[0];
        } else if (this.prisma.user?.findFirst) {
          const user = await this.prisma.user.findFirst({
            where: { id: actor.sub, deletedAt: null },
            select: {
              businessId: true,
              ownedBusinesses: {
                where: { deletedAt: null },
                select: { id: true },
                take: 1,
              },
            },
          });
          resolvedBiz = user?.businessId || user?.ownedBusinesses?.[0]?.id;
        }
      }
      if (!resolvedBiz) {
        throw new ForbiddenException('Create a business before continuing');
      }

      const ownedBusinessIds = new Set(actor.businessIds ?? []);
      if (actor.businessId) {
        ownedBusinessIds.add(actor.businessId);
      }
      if (!ownedBusinessIds.has(resolvedBiz)) {
        if (this.prisma.user?.findFirst) {
          const user = await this.prisma.user.findFirst({
            where: { id: actor.sub, deletedAt: null },
            select: {
              businessId: true,
              ownedBusinesses: {
                where: { deletedAt: null },
                select: { id: true },
              },
            },
          });
          const dbOwned = new Set(
            user?.ownedBusinesses?.map((b) => b.id) ?? [],
          );
          if (user?.businessId) dbOwned.add(user.businessId);
          if (!dbOwned.has(resolvedBiz)) {
            throw new ForbiddenException(
              'You do not have access to this business',
            );
          }
        } else {
          throw new ForbiddenException('You do not have access to this business');
        }
      }

      where.location = { businessId: resolvedBiz };

      if (query.locationId) {
        if (this.prisma.location?.findFirst) {
          const loc = await this.prisma.location.findFirst({
            where: {
              id: query.locationId,
              businessId: resolvedBiz,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!loc) {
            throw new NotFoundException(
              'Location not found in the selected business',
            );
          }
        }
        where.locationId = query.locationId;
      }

      if (isOwnOrders) {
        where.cashierId = actor.sub;
      } else if (query.cashierId) {
        where.cashierId = query.cashierId;
      }
    } else if (actor?.role === Role.SUPER_ADMIN) {
      if (query.businessId) {
        where.location = { businessId: query.businessId };
      }
      if (query.locationId) {
        where.locationId = query.locationId;
      }
      if (isOwnOrders) {
        where.cashierId = actor.sub;
      } else if (query.cashierId) {
        where.cashierId = query.cashierId;
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

    if (query.range || query.month || query.week || query.year) {
      const dateRange = resolveDhakaDateRange({
        range: query.range,
        month: query.month,
        week: query.week,
        year: query.year,
      });
      if (dateRange) {
        where.occurredAt = {
          gte: dateRange.gte,
          ...(dateRange.lte ? { lte: dateRange.lte } : {}),
        };
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

    const [total, rawItems] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: unifiedOrderSelect,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = rawItems.map((order) => presentOrder(order));

    return {
      items,
      page,
      limit,
      total,
    };
  }

  async getOrderById(
    actor: AccessTokenPayload,
    orderId: string,
  ): Promise<PresentedOrder> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        ...unifiedOrderSelect,
        location: {
          select: {
            id: true,
            businessId: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (actor.role === Role.CASHIER) {
      if (!actor.businessId || !actor.locationId) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
      if (
        order.location?.businessId !== actor.businessId ||
        order.locationId !== actor.locationId
      ) {
        throw new ForbiddenException('You do not have access to this order');
      }
    } else if (actor.role === Role.ADMIN) {
      const ownedBusinessIds = new Set(actor.businessIds ?? []);
      if (actor.businessId) {
        ownedBusinessIds.add(actor.businessId);
      }
      if (
        !order.location?.businessId ||
        !ownedBusinessIds.has(order.location.businessId)
      ) {
        if (this.prisma.user?.findFirst) {
          const user = await this.prisma.user.findFirst({
            where: { id: actor.sub, deletedAt: null },
            select: {
              businessId: true,
              ownedBusinesses: {
                where: { deletedAt: null },
                select: { id: true },
              },
            },
          });
          const dbOwned = new Set(
            user?.ownedBusinesses?.map((b) => b.id) ?? [],
          );
          if (user?.businessId) dbOwned.add(user.businessId);
          if (!dbOwned.has(order.location?.businessId ?? '')) {
            throw new ForbiddenException(
              'You do not have access to this order',
            );
          }
        } else {
          throw new ForbiddenException('You do not have access to this order');
        }
      }
    }

    return presentOrder(order);
  }

  // Legacy checkout support
  async checkout(
    actor: AccessTokenPayload,
    dto: CreateOrderDto,
  ): Promise<PresentedOrder> {
    let businessId = actor.businessId;
    if (!businessId && actor.role === Role.ADMIN) {
      const user = await this.prisma.user.findFirst({
        where: { id: actor.sub, deletedAt: null },
        select: {
          businessId: true,
          ownedBusinesses: {
            where: { deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      businessId = user?.businessId || user?.ownedBusinesses?.[0]?.id;
    }
    if (!businessId) {
      throw new ForbiddenException('Create a business before continuing');
    }
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
    const locationId = actor.locationId ?? fallbackLocationId;
    if (!locationId) {
      throw new BadRequestException('Location ID is required');
    }

    const shift = await tx.shiftSession.findFirst({
      where: {
        businessId,
        cashierId: actor.sub,
        status: ShiftStatus.OPEN,
        locationId,
      },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    const shiftId = shift?.id ?? null;

    const variantStockMap = new Map<string, number>();
    for (const item of dto.items) {
      if (item.variantId?.trim()) {
        const vId = item.variantId.trim();
        variantStockMap.set(
          vId,
          (variantStockMap.get(vId) ?? 0) + item.quantity,
        );
      }
    }

    for (const vId of variantStockMap.keys()) {
      const variant = await tx.variant.findFirst({
        where: {
          id: vId,
          businessId,
          deletedAt: null,
          isActive: true,
          product: { businessId, deletedAt: null, isActive: true },
        },
        select: {
          id: true,
          stock: true,
          locationStocks: {
            where: { locationId },
            select: { id: true, stock: true },
          },
        },
      });

      if (!variant) {
        throw new NotFoundException('Variant not found');
      }
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
            isActive: true,
            product: { businessId, deletedAt: null, isActive: true },
          },
          include: {
            product: {
              select: {
                name: true,
                category: { select: { name: true } },
              },
            },
          },
        });

        if (!variant) {
          throw new NotFoundException('Variant not found');
        }

        lines.push({
          variantId: variant.id,
          productName:
            (variant as any).product?.name ??
            (variant as any).name ??
            'Catalog Item',
          variantName: (variant as any).name ?? null,
          unitCost: variant.costPrice ?? null,
          categoryName:
            (variant as any).product?.category?.name ?? 'Uncategorized',
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
        unitCost: null,
        categoryName: 'Uncategorized',
        unitPrice: item.price,
        price: item.price,
        quantity: item.quantity,
        subtotal: lineTotal(item.price, item.quantity),
      });
    }

    const stockResults: Array<{
      variantId: string;
      previousStock: number;
      quantity: number;
      resultingStock: number;
    }> = [];
    for (const [vId, totalQty] of variantStockMap.entries()) {
      const variant = await tx.variant.findFirst({
        where: { id: vId, businessId, deletedAt: null },
        select: { stock: true },
      });
      if (!variant) {
        throw new NotFoundException('Variant not found');
      }
      let previousStock = 0;
      let resultingStock = -totalQty;
      if ((tx as any).locationStock && locationId) {
        const locStock = await (tx as any).locationStock.findUnique({
          where: { locationId_variantId: { locationId, variantId: vId } },
        });
        if (locStock) {
          previousStock = locStock.stock;
          const updated = await (tx as any).locationStock.update({
            where: { id: locStock.id },
            data: { stock: { decrement: totalQty } },
            select: { stock: true },
          });
          resultingStock = updated.stock;
        } else {
          const created = await (tx as any).locationStock.create({
            data: {
              businessId,
              locationId,
              variantId: vId,
              stock: -totalQty,
            },
            select: { stock: true },
          });
          resultingStock = created.stock;
        }
      }

      const decremented = await tx.variant.updateMany({
        where: { id: vId, businessId },
        data: { stock: { decrement: totalQty } },
      });

      if (decremented.count === 0) {
        throw new NotFoundException('Variant not found');
      }

      await tx.stockTransaction.create({
        data: {
          variantId: vId,
          locationId: locationId ?? null,
          type: StockTransactionType.SALE,
          quantity: totalQty,
          notes: receiptNumber,
        },
      });
      stockResults.push({
        variantId: vId,
        previousStock,
        quantity: totalQty,
        resultingStock,
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

    const order = await tx.order.create({
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
            unitCost: l.unitCost,
            categoryName: l.categoryName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
          })),
        },
      },
      select: unifiedOrderSelect,
    });

    for (const stock of stockResults) {
      if (stock.resultingStock <= LOW_STOCK_THRESHOLD) {
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            businessId,
            locationId,
            action: 'LOW_STOCK_AFTER_SALE',
            entityType: 'VARIANT',
            entityId: stock.variantId,
            metadata: {
              orderId: order.id,
              invoiceNumber: receiptNumber,
              variantId: stock.variantId,
              locationId,
              previousStock: stock.previousStock,
              quantitySold: stock.quantity,
              resultingStock: stock.resultingStock,
              deviceId: null,
            },
          },
        });
      }
    }

    return presentOrder(order);
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
          occurredAt: true,
          lines: {
            select: {
              quantity: true,
              refundItems: { select: { quantity: true } },
            },
          },
        },
        orderBy: { occurredAt: 'desc' },
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
        occurredAt: order.occurredAt,
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
