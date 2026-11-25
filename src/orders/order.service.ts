import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
import {
  getDhakaDayRange,
  parseStrictEventInstant,
  resolveDhakaDateRange,
} from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogOrderDto } from './dto/create-catalog-order.dto';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders.query';
import { ListOrdersQueryDto } from './dto/list-orders.query';
import { SyncOrderItemDto, SyncOrdersDto } from './dto/sync-orders.dto';
import { ConfirmLegacySyncDto } from './dto/confirm-legacy-sync.dto';
import { createInvoiceNumber } from './invoice-number';
import { assertTender, lineTotal, sumMoney } from './money';
import { toStoredJson } from '../common/interceptors/to-stored-json';
import { computeSyncPayloadHash } from './sync-payload-hash';
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
  location: {
    select: {
      id: true,
      name: true,
      address: true,
      businessId: true,
      business: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  shiftId: true,
  cashierId: true,
  cashier: {
    select: {
      id: true,
      fullName: true,
      publicId: true,
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
  refundStatus?: RefundStatus | null;
  totalRefundedAmount?: number;
  type?: OrderType;
  businessId?: string | null;
  businessName?: string | null;
  locationName?: string | null;
  branchName?: string | null;
  cashierName?: string | null;
  cashierPublicId?: string | null;
  sellerName?: string | null;
  sellerRole?: string | null;
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

export function presentOrder(order: any): PresentedOrder {
  if (!order) return order;
  const rawLines = Array.isArray(order.lines) ? order.lines : [];
  const lines = rawLines.map(presentOrderLine);
  const totalRefundedAmount = lines.reduce(
    (sum: number, line: PresentedOrderLine) => sum + (line.refundedAmount ?? 0),
    0,
  );
  const computedRefundStatus = refundStatus(
    lines.map((l: PresentedOrderLine) => ({
      quantity: l.quantity,
      refunded: l.refundedQuantity,
    })),
  );

  const locationName = order.location?.name ?? order.locationName ?? null;
  const branchName = locationName;
  const businessId =
    order.location?.businessId ??
    order.businessId ??
    order.location?.business?.id ??
    null;
  const businessName =
    order.location?.business?.name ?? order.businessName ?? null;
  const cashierName = order.cashier?.fullName ?? order.cashierName ?? null;
  const cashierPublicId =
    order.cashier?.publicId ?? order.cashierPublicId ?? null;
  const sellerName = cashierName;
  const sellerRole = order.cashier?.role ?? order.sellerRole ?? null;

  return {
    ...order,
    type: order.orderType ?? order.type,
    businessId,
    businessName,
    locationName,
    branchName,
    cashierName,
    cashierPublicId,
    sellerName,
    sellerRole,
    lines,
    refundStatus: computedRefundStatus,
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

export type OfflineOrderOptions = {
  executionMode?: 'LEGACY_SYNC' | 'LOCAL_FIRST';
  pricePolicy?: 'CURRENT_PRICE' | 'CAPTURED_PRICE';
  closedShiftPolicy?: 'REVIEW' | 'DETACH_WITH_WARNING';
  syncProtocol?: 2;
  clientOrderId: string;
  clientReceiptNumber?: string;
  deviceId: string;
  occurredAt: Date;
  rawOccurredAt?: string;
  syncPayloadHash?: string;
  warnings: string[];
  syncAuditMetadata?: Record<string, unknown>;
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
  occurredAt?: string;
  createdAt?: string;
  errorCode?: string;
  error?: string;
  warnings: string[];
  reconciliationId?: string;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async createCatalogOrder(
    actor: AccessTokenPayload | string,
    dto: CatalogOrderInput,
    options?: OfflineOrderOptions,
  ): Promise<PresentedOrder> {
    assertTender(dto.tenderedAmount);
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Order must contain at least one line item',
      );
    }

    const operationTime = options?.occurredAt ?? new Date();

    for (let attempt = 1; attempt <= INVOICE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = createInvoiceNumber();
            return await this.executeCatalogOrder(
              tx,
              actor,
              dto,
              invoiceNumber,
              options,
              operationTime,
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
    dto: { businessId?: string; locationId?: string; shiftId?: string | null },
    warnings?: string[],
    isOfflineSync = false,
    operationTime = new Date(),
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
    let effectiveBusinessId: string;
    if (effectiveRole === Role.ADMIN) {
      if (!requestedBusinessId?.trim()) {
        throw new BadRequestException(
          'businessId is required for Admin checkout',
        );
      }
      effectiveBusinessId = requestedBusinessId.trim();
    } else {
      effectiveBusinessId = (actorBusinessId ?? user.businessId) as string;
    }
    const effectiveLocationId = actorLocationId ?? user.locationId;
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
      const anyLocation = await tx.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (
        anyLocation &&
        anyLocation.businessId &&
        anyLocation.businessId !== effectiveBusinessId
      ) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
      throw new NotFoundException('Location not found');
    }

    const businessId = effectiveBusinessId;

    let shiftId: string | null = null;
    if (dto.shiftId === null) {
      shiftId = null;
    } else if (typeof dto.shiftId === 'string' && dto.shiftId.trim() !== '') {
      const shift = await tx.shiftSession.findFirst({
        where: { id: dto.shiftId.trim(), businessId },
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
        if (!isOfflineSync) {
          throw new BadRequestException(
            'Provided shiftId is invalid, closed, or not accessible',
          );
        }
        shiftId = null;
        this.addWarning(warnings, 'SHIFT_NOT_ATTACHED');
      }
    } else {
      if (isOfflineSync) {
        shiftId = null;
        this.addWarning(warnings, 'SHIFT_NOT_ATTACHED');
      } else {
        const { start: startOfToday, nextStart: nextDayStart } =
          getDhakaDayRange(operationTime);
        const activeShift = await tx.shiftSession.findFirst({
          where: {
            businessId,
            cashierId: userId,
            locationId,
            status: ShiftStatus.OPEN,
            openedAt: {
              gte: startOfToday,
              lt: nextDayStart,
            },
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
    operationTime = new Date(),
  ): Promise<PresentedOrder> {
    const isOfflineSync =
      options?.executionMode === 'LOCAL_FIRST'
        ? options.closedShiftPolicy === 'DETACH_WITH_WARNING'
        : Boolean(options?.clientOrderId);
    const resolvedContext = await this.resolveOrderExecutionContext(
      tx,
      actor,
      dto,
      options?.warnings,
      isOfflineSync,
      operationTime,
    );
    const { userId, businessId, locationId } = resolvedContext;
    let shiftId = resolvedContext.shiftId;
    if (options?.syncProtocol === 2)
      await this.reserveLocalIdentity(tx, options, {
        userId,
        businessId,
        locationId,
      });

    const allowCapturedPrices =
      options?.executionMode === 'LOCAL_FIRST'
        ? options.pricePolicy === 'CAPTURED_PRICE'
        : Boolean(options);

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
            id: true,
            name: true,
            isActive: true,
            deletedAt: true,
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
        if (options?.syncProtocol === 2) {
          throw new ConflictException({
            code: 'ITEM_UNAVAILABLE_REVIEW_REQUIRED',
            message:
              'The original catalog variant is unavailable. Keep the saved sale and payment evidence for review.',
          });
        }
        if (!allowCapturedPrices) {
          throw new NotFoundException(`Variant not found: ${line.variantId}`);
        }
        unavailableLines.push(line);
        this.addWarning(options?.warnings, 'VARIANT_UNAVAILABLE');
        continue;
      }

      if (!allowCapturedPrices) {
        if (!variant.isActive || variant.deletedAt) {
          throw new BadRequestException(
            `Variant "${variant.name}" is inactive or unavailable for online sale`,
          );
        }
        if (!variant.product.isActive || variant.product.deletedAt) {
          throw new BadRequestException(
            `Product "${variant.product.name}" is inactive or archived`,
          );
        }
      }

      const current = requiredStock.get(line.variantId) ?? 0;
      requiredStock.set(line.variantId, current + line.quantity);
    }

    if (!allowCapturedPrices) {
      for (const line of dto.lines) {
        const variant = variantMap.get(line.variantId);
        if (
          variant &&
          line.unitPrice !== undefined &&
          line.unitPrice !== null &&
          line.unitPrice !== variant.sellingPrice
        ) {
          throw new ConflictException({
            code: 'PRICE_CHANGED',
            message: `Price for variant "${variant.name || variant.id}" has changed from ${line.unitPrice} to ${variant.sellingPrice}`,
            variantId: variant.id,
            submittedPrice: line.unitPrice,
            currentPrice: variant.sellingPrice,
          });
        }
      }
    }

    // 2. Compute Totals
    const preparedLines = dto.lines.map((line) => {
      const variant = variantMap.get(line.variantId);
      const unitPrice = allowCapturedPrices
        ? line.unitPrice
        : variant!.sellingPrice;
      const subtotal = lineTotal(unitPrice, line.quantity);

      if (
        allowCapturedPrices &&
        options &&
        variant &&
        unitPrice !== variant.sellingPrice
      ) {
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

    // 3. Database Transaction: stock decrement & transactions.
    // Existing business policy permits negative stock in both online and deferred sales.
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

      // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode.
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

    if (
      dto.paymentMethod &&
      dto.paymentType &&
      dto.paymentMethod !== dto.paymentType
    ) {
      throw new BadRequestException(
        'paymentMethod and paymentType must match if both are provided',
      );
    }
    const paymentMethod = dto.paymentMethod ?? dto.paymentType;
    if (
      !paymentMethod ||
      !Object.values(PaymentMethod).includes(paymentMethod)
    ) {
      throw new BadRequestException(
        'Explicit payment method is required: COD, BKASH, NAGAD, BANK',
      );
    }

    // Only COD orders increment physical drawer cash
    const isExplicitShift =
      typeof dto.shiftId === 'string' && dto.shiftId.trim() !== '';
    if (shiftId && paymentMethod === PaymentMethod.COD) {
      if (tx.shiftSession?.updateMany) {
        const res = await tx.shiftSession.updateMany({
          where: { id: shiftId, status: ShiftStatus.OPEN },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
        if (res.count === 0) {
          if (isExplicitShift) {
            throw new ConflictException(
              'Register shift is closed or inactive. Cash sale requires an open shift.',
            );
          }
          shiftId = null;
          if (options) {
            this.addWarning(options.warnings, 'SHIFT_NOT_ATTACHED');
          }
        }
      } else if (tx.shiftSession?.update) {
        await tx.shiftSession.update({
          where: { id: shiftId },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
      }
    }

    const order = await tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        clientOrderId: options?.clientOrderId,
        clientReceiptNumber: options?.clientReceiptNumber,
        deviceId: options?.deviceId,
        occurredAt: options?.occurredAt ?? operationTime,
        syncPayloadHash: options?.syncPayloadHash ?? null,
        ...(options?.syncProtocol === 2 ? { syncProtocol: 2 } : {}),
        orderType: OrderType.CATALOG,
        status: OrderStatus.PAID,
        locationId,
        shiftId: shiftId ?? null,
        cashierId: userId,
        subtotal,
        totalAmount,
        tenderedAmount: dto.tenderedAmount,
        changeDue,
        customerName: dto.customerName?.trim() || 'Walk-in Customer',
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

    // Freeze every acceptance warning before saving the replay audit.
    for (const stock of stockResults) {
      if (stock.resultingStock <= LOW_STOCK_THRESHOLD)
        this.addWarning(options?.warnings, 'LOW_STOCK_AFTER_SALE');
    }

    if (options?.syncAuditMetadata && tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          action: 'OFFLINE_ORDER_ACCEPTED',
          entityType: 'Order',
          entityId: order.id,
          businessId,
          locationId,
          actorId: userId,
          metadata: {
            ...options.syncAuditMetadata,
            orderId: order.id,
            orderCreatedAt: order.createdAt,
          },
        },
      });
    }

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

    const receipt = presentOrder(order);
    if (options?.syncProtocol === 2)
      await this.storeLocalReceipt(tx, order.id, receipt, options.warnings);
    return receipt;
  }

  async createCustomOrder(
    actor: AccessTokenPayload | string,
    dto: CreateCustomOrderDto,
    options?: OfflineOrderOptions,
  ): Promise<PresentedOrder> {
    assertTender(dto.tenderedAmount);
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Order must contain at least one line item',
      );
    }

    const operationTime = options?.occurredAt ?? new Date();

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
              operationTime,
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
    operationTime = new Date(),
  ): Promise<PresentedOrder> {
    const isOfflineSync =
      options?.executionMode === 'LOCAL_FIRST'
        ? options.closedShiftPolicy === 'DETACH_WITH_WARNING'
        : Boolean(options?.clientOrderId);
    const resolvedContext = await this.resolveOrderExecutionContext(
      tx,
      actor,
      dto,
      options?.warnings,
      isOfflineSync,
      operationTime,
    );
    const { userId, businessId, locationId } = resolvedContext;
    let shiftId = resolvedContext.shiftId;
    if (options?.syncProtocol === 2)
      await this.reserveLocalIdentity(tx, options, {
        userId,
        businessId,
        locationId,
      });

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
    if (
      dto.paymentMethod &&
      dto.paymentType &&
      dto.paymentMethod !== dto.paymentType
    ) {
      throw new BadRequestException(
        'paymentMethod and paymentType must match if both are provided',
      );
    }
    const paymentMethod = dto.paymentMethod ?? dto.paymentType;
    if (
      !paymentMethod ||
      !Object.values(PaymentMethod).includes(paymentMethod)
    ) {
      throw new BadRequestException(
        'Explicit payment method is required: COD, BKASH, NAGAD, BANK',
      );
    }

    // 3. Database Transaction
    // Only COD orders increment physical drawer cash
    const isExplicitShift =
      typeof dto.shiftId === 'string' && dto.shiftId.trim() !== '';
    if (shiftId && paymentMethod === PaymentMethod.COD) {
      if (tx.shiftSession?.updateMany) {
        const res = await tx.shiftSession.updateMany({
          where: { id: shiftId, status: ShiftStatus.OPEN },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
        if (res.count === 0) {
          if (isExplicitShift) {
            throw new ConflictException(
              'Register shift is closed or inactive. Cash sale requires an open shift.',
            );
          }
          shiftId = null;
          if (options) {
            this.addWarning(options.warnings, 'SHIFT_NOT_ATTACHED');
          }
        }
      } else if (tx.shiftSession?.update) {
        await tx.shiftSession.update({
          where: { id: shiftId },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
      }
    }

    const order = await tx.order.create({
      data: {
        invoiceNumber,
        receiptNumber: invoiceNumber,
        clientOrderId: options?.clientOrderId,
        clientReceiptNumber: options?.clientReceiptNumber,
        deviceId: options?.deviceId,
        occurredAt: options?.occurredAt ?? operationTime,
        syncPayloadHash: options?.syncPayloadHash ?? null,
        ...(options?.syncProtocol === 2 ? { syncProtocol: 2 } : {}),
        orderType: OrderType.CUSTOM,
        status: OrderStatus.PAID,
        locationId,
        shiftId: shiftId ?? null,
        cashierId: userId,
        subtotal,
        totalAmount,
        tenderedAmount: dto.tenderedAmount,
        changeDue,
        customerName: dto.customerName?.trim() || 'Walk-in Customer',
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

    if (options?.syncAuditMetadata && tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          action: 'OFFLINE_ORDER_ACCEPTED',
          entityType: 'Order',
          entityId: order.id,
          businessId,
          locationId,
          actorId: userId,
          metadata: {
            ...options.syncAuditMetadata,
            orderId: order.id,
            orderCreatedAt: order.createdAt,
          },
        },
      });
    }

    const receipt = presentOrder(order);
    if (options?.syncProtocol === 2)
      await this.storeLocalReceipt(tx, order.id, receipt, options.warnings);
    return receipt;
  }

  private async reserveLocalIdentity(
    tx: Prisma.TransactionClient,
    options: OfflineOrderOptions,
    scope: { userId: string; businessId: string; locationId: string },
  ) {
    await tx.financialSaleIdentity.create({
      data: { id: options.clientOrderId, ...scope, protocol: 'LOCAL_FIRST_V2' },
    });
  }

  private async storeLocalReceipt(
    tx: Prisma.TransactionClient,
    orderId: string,
    receipt: PresentedOrder,
    warnings: string[],
  ) {
    // In the SAME database transaction: a commit always has its original receipt and warnings.
    await tx.order.update({
      where: { id: orderId },
      data: {
        syncReceipt: toStoredJson(receipt),
        syncWarnings: toStoredJson(warnings),
      },
    });
  }

  async syncOrders(
    actor: AccessTokenPayload,
    dto: SyncOrdersDto,
  ): Promise<{ serverTime: string; results: SyncOrderResult[] }> {
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

    const serverTime = new Date();
    const envSkew = process.env.OFFLINE_MAX_FUTURE_SKEW_SECONDS;
    const rawSkew =
      this.configService?.get('OFFLINE_MAX_FUTURE_SKEW_SECONDS') ?? envSkew;
    const parsedSkew =
      rawSkew === undefined || rawSkew === '' ? 300 : Number(rawSkew);
    const maxFutureSkewSeconds =
      Number.isFinite(parsedSkew) && parsedSkew >= 0
        ? Math.floor(parsedSkew)
        : 300;
    const maxSkewMs = maxFutureSkewSeconds * 1000;

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
          errorCode: 'VALIDATION_ERROR',
          warnings: [],
          error: this.validationMessage(validationErrors),
        });
        continue;
      }

      // 1. Strict Timestamp Validation
      const parsedInstant = parseStrictEventInstant(item.occurredAt);
      if (!parsedInstant.isValid) {
        if (parsedInstant.errorType === 'TIMEZONE_REQUIRED') {
          results.push({
            clientOrderId: item.clientOrderId,
            status: 'REJECTED',
            errorCode: 'TIMESTAMP_TIMEZONE_REQUIRED',
            warnings: [],
            error:
              'Timestamp must include an explicit UTC offset or Z timezone',
          });
          continue;
        }
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'TIMESTAMP_INVALID',
          warnings: [],
          error: parsedInstant.error || 'Invalid timestamp format',
        });
        continue;
      }

      const shapeError = this.validateSyncOrderShape(item);
      if (shapeError) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'VALIDATION_ERROR',
          warnings: [],
          error: shapeError,
        });
        continue;
      }

      // 2. Canonical Payload Hash
      let computedPayloadHash: string;
      try {
        computedPayloadHash = computeSyncPayloadHash({
          clientOrderId: item.clientOrderId,
          deviceId: dto.deviceId,
          businessId: syncActor.businessId,
          locationId: syncActor.locationId,
          cashierId: syncActor.sub,
          occurredAt: parsedInstant.date!,
          orderType: item.orderType,
          paymentMethod: item.paymentMethod,
          tenderedAmount: item.tenderedAmount,
          shiftId: item.shiftId,
          clientReceiptNumber: item.clientReceiptNumber,
          customerName: item.customerName,
          customerPhone: item.customerPhone,
          notes: item.notes,
          lines: item.lines,
        });
      } catch (err: any) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'INVALID_FINANCIAL_VALUE',
          warnings: [],
          error: err?.message || 'Invalid financial value in payload',
        });
        continue;
      }

      // 3. Check for existing order (duplicate fast path before new-order clock-skew check)
      const existingOrder = this.prisma.order.findUnique
        ? await this.prisma.order.findUnique({
            where: { clientOrderId: item.clientOrderId },
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              occurredAt: true,
              createdAt: true,
              locationId: true,
              cashierId: true,
              deviceId: true,
              syncPayloadHash: true,
              location: { select: { businessId: true } },
              lines: { select: { quantity: true, unitPrice: true } },
            },
          })
        : null;

      if (existingOrder) {
        const replayResult = await this.verifySyncReplay(
          existingOrder,
          computedPayloadHash,
          syncActor,
          dto.deviceId,
          item,
        );
        results.push(replayResult);
        continue;
      }

      // 4. Clock Skew Validation for new orders
      const eventTimeMs = parsedInstant.date!.getTime();
      const skewMs = eventTimeMs - serverTime.getTime();

      if (skewMs > maxSkewMs) {
        results.push({
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'TIMESTAMP_FUTURE_REVIEW_REQUIRED',
          warnings: [],
          error:
            'Event time exceeds the allowed future clock difference; retain this sale for review.',
        });
        continue;
      }

      const warnings: string[] = [];
      if (skewMs > 0 && skewMs <= maxSkewMs) {
        warnings.push('CLOCK_SKEW_TOLERATED');
      }

      const options: OfflineOrderOptions = {
        executionMode: 'LEGACY_SYNC',
        clientOrderId: item.clientOrderId,
        clientReceiptNumber: item.clientReceiptNumber,
        deviceId: dto.deviceId,
        occurredAt: parsedInstant.date!,
        rawOccurredAt: item.occurredAt,
        syncPayloadHash: computedPayloadHash,
        warnings,
        syncAuditMetadata: {
          actorId: syncActor.sub,
          businessId: syncActor.businessId,
          locationId: syncActor.locationId,
          deviceId: dto.deviceId,
          clientOrderId: item.clientOrderId,
          rawOccurredAt: item.occurredAt,
          normalizedOccurredAt: parsedInstant.date!.toISOString(),
          serverReferenceTime: serverTime.toISOString(),
          policyVersion: 'v1',
          maxFutureSkewSeconds,
          warnings,
          eventTimeSource: 'DEVICE_REPORTED',
        },
      };

      try {
        const common = {
          businessId: syncActor.businessId,
          locationId: syncActor.locationId,
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
          occurredAt:
            order.occurredAt?.toISOString?.() ??
            parsedInstant.date!.toISOString(),
          createdAt:
            order.createdAt?.toISOString?.() ?? serverTime.toISOString(),
          warnings,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const raceWinner = this.prisma.order.findUnique
            ? await this.prisma.order.findUnique({
                where: { clientOrderId: item.clientOrderId },
                select: {
                  id: true,
                  invoiceNumber: true,
                  totalAmount: true,
                  occurredAt: true,
                  createdAt: true,
                  locationId: true,
                  cashierId: true,
                  deviceId: true,
                  syncPayloadHash: true,
                  location: { select: { businessId: true } },
                  lines: { select: { quantity: true, unitPrice: true } },
                },
              })
            : null;
          if (raceWinner) {
            const replayResult = await this.verifySyncReplay(
              raceWinner,
              computedPayloadHash,
              syncActor,
              dto.deviceId,
              item,
            );
            results.push(replayResult);
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

    return {
      serverTime: serverTime.toISOString(),
      results,
    };
  }

  private async verifySyncReplay(
    existing: any,
    computedPayloadHash: string,
    syncActor: {
      businessId?: string | null;
      locationId?: string | null;
      sub: string;
    },
    deviceId: string,
    item: SyncOrderItemDto,
  ): Promise<SyncOrderResult> {
    const existingBusinessId =
      existing.location?.businessId ?? existing.businessId;
    const isContextMatch =
      existingBusinessId === syncActor.businessId &&
      (!existing.locationId || existing.locationId === syncActor.locationId) &&
      (!existing.cashierId || existing.cashierId === syncActor.sub) &&
      (!existing.deviceId || existing.deviceId === deviceId);

    if (!isContextMatch) {
      return {
        clientOrderId: item.clientOrderId,
        status: 'REJECTED',
        errorCode: 'SYNC_IDENTITY_CONFLICT',
        error: 'clientOrderId is already used in another context',
        warnings: [],
      };
    }

    if (existing.syncPayloadHash) {
      if (existing.syncPayloadHash !== computedPayloadHash) {
        return {
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'SYNC_PAYLOAD_MISMATCH',
          error:
            'clientOrderId replay mismatch: payload does not match existing order',
          warnings: [],
        };
      }

      let originalWarnings: string[] = [];
      if (this.prisma.auditLog?.findFirst) {
        const audit = await this.prisma.auditLog.findFirst({
          where: {
            action: 'OFFLINE_ORDER_ACCEPTED',
            entityType: 'Order',
            entityId: existing.id,
          },
          select: { metadata: true },
        });
        originalWarnings = (audit?.metadata as any)?.warnings || [];
      }

      return {
        clientOrderId: item.clientOrderId,
        status: 'DUPLICATE',
        orderId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        occurredAt:
          existing.occurredAt?.toISOString?.() ??
          (typeof existing.occurredAt === 'string' ? existing.occurredAt : ''),
        createdAt:
          existing.createdAt?.toISOString?.() ??
          (typeof existing.createdAt === 'string' ? existing.createdAt : ''),
        warnings: originalWarnings,
      };
    }

    // Legacy unhashed order: check if confirmed
    let confirmedAudit: any = null;
    if (this.prisma.auditLog?.findFirst) {
      confirmedAudit = await this.prisma.auditLog.findFirst({
        where: {
          action: 'LEGACY_SYNC_REPLAY_CONFIRMED',
          entityType: 'Order',
          entityId: existing.id,
        },
      });
    }

    if (confirmedAudit) {
      const meta = confirmedAudit.metadata as Record<string, unknown> | null;
      if (
        meta?.payloadFingerprint &&
        meta.payloadFingerprint !== computedPayloadHash
      ) {
        return {
          clientOrderId: item.clientOrderId,
          status: 'REJECTED',
          errorCode: 'SYNC_PAYLOAD_MISMATCH',
          error:
            'clientOrderId replay mismatch: payload does not match admin-confirmed fingerprint',
          warnings: [],
        };
      }

      return {
        clientOrderId: item.clientOrderId,
        status: 'DUPLICATE',
        orderId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        occurredAt:
          existing.occurredAt?.toISOString?.() ??
          (typeof existing.occurredAt === 'string' ? existing.occurredAt : ''),
        createdAt:
          existing.createdAt?.toISOString?.() ??
          (typeof existing.createdAt === 'string' ? existing.createdAt : ''),
        warnings: ['LEGACY_REPLAY_ADMIN_CONFIRMED'],
        reconciliationId: confirmedAudit.id,
      };
    }

    // In legacy orders, if payload was modified (different total), check totals as well
    const payloadTotal = item.lines.reduce(
      (sum, line) => sum + (line.unitPrice ?? 0) * line.quantity,
      0,
    );
    if (
      existing.totalAmount !== undefined &&
      existing.totalAmount !== payloadTotal
    ) {
      return {
        clientOrderId: item.clientOrderId,
        status: 'REJECTED',
        errorCode: 'SYNC_PAYLOAD_MISMATCH',
        error:
          'clientOrderId replay mismatch: payload does not match existing order',
        warnings: [],
      };
    }

    return {
      clientOrderId: item.clientOrderId,
      status: 'REJECTED',
      errorCode: 'LEGACY_SYNC_REPLAY_REVIEW_REQUIRED',
      error:
        'Legacy sync order requires admin review and confirmation before replay acknowledgment',
      warnings: [],
    };
  }

  async confirmLegacySync(
    actor: AccessTokenPayload,
    orderId: string,
    dto: ConfirmLegacySyncDto,
  ): Promise<{
    status: 'DUPLICATE';
    warnings: string[];
    clientOrderId: string;
    orderId: string;
    invoiceNumber: string;
    occurredAt: string;
    createdAt: string;
    reconciliationId: string;
  }> {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only administrators can confirm legacy sync replays',
      );
    }

    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Confirmation reason is required');
    }

    if (!dto.order || !dto.order.clientOrderId) {
      throw new BadRequestException('Sync order payload is required');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        lines: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify tenant authorization
    if (actor.role === Role.ADMIN) {
      const allowedBusinessIds = new Set(
        [actor.businessId, ...(actor.businessIds || [])].filter(Boolean),
      );
      if (!allowedBusinessIds.has(order.location.businessId)) {
        throw new ForbiddenException('You do not have access to this business');
      }
    }

    if (!order.clientOrderId) {
      throw new BadRequestException('Order does not have a clientOrderId');
    }

    if (order.clientOrderId !== dto.order.clientOrderId) {
      throw new BadRequestException(
        'clientOrderId mismatch between target order and submitted payload',
      );
    }

    if (order.syncPayloadHash) {
      throw new BadRequestException(
        'Order already has an immutable syncPayloadHash and does not require legacy confirmation',
      );
    }

    const payloadTotal = dto.order.lines.reduce(
      (sum, l) => sum + (l.unitPrice ?? 0) * l.quantity,
      0,
    );
    if (order.totalAmount !== payloadTotal) {
      throw new BadRequestException(
        'Material mismatch: submitted payload total amount differs from stored legacy order',
      );
    }

    const expectedPaymentMethod = dto.order.paymentMethod ?? PaymentMethod.COD;
    if (order.paymentMethod !== expectedPaymentMethod) {
      throw new BadRequestException(
        'Material mismatch: submitted payment method differs from stored legacy order',
      );
    }

    if (order.lines.length !== dto.order.lines.length) {
      throw new BadRequestException(
        'Material mismatch: line item count differs from stored legacy order',
      );
    }

    // Reconcile line item details (quantity, price, variant) between stored legacy order and submitted payload
    for (const storedLine of order.lines) {
      const match = dto.order.lines.find(
        (l) =>
          (l.variantId ? l.variantId === storedLine.variantId : true) &&
          l.quantity === storedLine.quantity &&
          l.unitPrice === storedLine.unitPrice,
      );
      if (!match) {
        throw new BadRequestException(
          'Material mismatch: line item details differ from stored legacy order',
        );
      }
    }

    // Compute reviewed payload fingerprint using original cashier context
    const reviewedFingerprint = computeSyncPayloadHash({
      clientOrderId: order.clientOrderId,
      deviceId: dto.deviceId,
      businessId: order.location.businessId,
      locationId: order.locationId,
      cashierId: order.cashierId,
      occurredAt: dto.order.occurredAt,
      orderType: dto.order.orderType,
      paymentMethod: dto.order.paymentMethod,
      tenderedAmount: dto.order.tenderedAmount,
      shiftId: dto.order.shiftId,
      clientReceiptNumber: dto.order.clientReceiptNumber,
      customerName: dto.order.customerName,
      customerPhone: dto.order.customerPhone,
      notes: dto.order.notes,
      lines: dto.order.lines,
    });

    const executeConfirmation = async (tx: Prisma.TransactionClient) => {
      const existingAudit = await tx.auditLog.findFirst({
        where: {
          action: 'LEGACY_SYNC_REPLAY_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
        },
      });

      if (existingAudit) {
        const meta = existingAudit.metadata as Record<string, unknown> | null;
        if (meta?.payloadFingerprint === reviewedFingerprint) {
          return {
            status: 'DUPLICATE' as const,
            warnings: ['LEGACY_REPLAY_ADMIN_CONFIRMED'],
            clientOrderId: order.clientOrderId!,
            orderId: order.id,
            invoiceNumber: order.invoiceNumber,
            occurredAt: order.occurredAt.toISOString(),
            createdAt: order.createdAt.toISOString(),
            reconciliationId: existingAudit.id,
          };
        }
        throw new ConflictException(
          'A conflicting confirmation already exists for this legacy order',
        );
      }

      const confirmedAt = new Date().toISOString();
      const audit = await tx.auditLog.create({
        data: {
          action: 'LEGACY_SYNC_REPLAY_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
          businessId: order.location.businessId,
          locationId: order.locationId,
          actorId: actor.sub,
          metadata: {
            reviewerId: actor.sub,
            originalCashierId: order.cashierId,
            businessId: order.location.businessId,
            locationId: order.locationId,
            deviceId: dto.deviceId,
            clientOrderId: order.clientOrderId,
            orderId: order.id,
            payloadFingerprint: reviewedFingerprint,
            reason: dto.reason.trim(),
            confirmedAt,
          },
        },
      });

      return {
        status: 'DUPLICATE' as const,
        warnings: ['LEGACY_REPLAY_ADMIN_CONFIRMED'],
        clientOrderId: order.clientOrderId!,
        orderId: order.id,
        invoiceNumber: order.invoiceNumber,
        occurredAt: order.occurredAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
        reconciliationId: audit.id,
      };
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction(executeConfirmation);
    }
    return executeConfirmation(
      this.prisma as unknown as Prisma.TransactionClient,
    );
  }

  private validateSyncOrderShape(item: SyncOrderItemDto): string | null {
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
      const resolvedBiz = query.businessId?.trim() || actor.businessId;
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
          throw new ForbiddenException(
            'You do not have access to this business',
          );
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
          lt: dateRange.lt,
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
    let businessId: string;
    if (actor.role === Role.ADMIN) {
      const explicitBusinessId = dto.businessId?.trim();
      if (!explicitBusinessId) {
        throw new BadRequestException(
          'businessId is required for Admin checkout',
        );
      }
      businessId = explicitBusinessId;
      const ownedBusinessIds = new Set(actor.businessIds ?? []);
      if (actor.businessId) {
        ownedBusinessIds.add(actor.businessId);
      }
      if (!ownedBusinessIds.has(businessId)) {
        throw new ForbiddenException('You do not have access to this business');
      }
    } else {
      if (!actor.businessId) {
        throw new ForbiddenException('Cashier must be assigned to a business');
      }
      businessId = actor.businessId;
    }

    let locationId: string;
    if (actor.role === Role.ADMIN) {
      const explicitLocationId = dto.locationId?.trim();
      if (!explicitLocationId) {
        throw new BadRequestException(
          'locationId is required for Admin checkout',
        );
      }
      locationId = explicitLocationId;
    } else {
      if (!actor.locationId) {
        throw new ForbiddenException('Cashier must be assigned to a location');
      }
      locationId = actor.locationId;
    }

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!location) {
      const anyLocation = await this.prisma.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (
        anyLocation &&
        anyLocation.businessId &&
        anyLocation.businessId !== businessId
      ) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
      throw new NotFoundException('Location not found for business');
    }

    const operationTime = new Date();

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
              operationTime,
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
    operationTime = new Date(),
  ): Promise<PresentedOrder> {
    const locationId = actor.locationId ?? fallbackLocationId;
    if (!locationId) {
      throw new BadRequestException('Location ID is required');
    }

    let shiftId: string | null = null;
    if (dto.shiftId === null) {
      shiftId = null;
    } else if (typeof dto.shiftId === 'string' && dto.shiftId.trim() !== '') {
      const shift = await tx.shiftSession.findFirst({
        where: { id: dto.shiftId.trim(), businessId },
        select: { id: true, status: true, locationId: true, cashierId: true },
      });
      const canAttach =
        shift?.status === ShiftStatus.OPEN &&
        (!shift.locationId || shift.locationId === locationId) &&
        (actor.role !== Role.CASHIER ||
          !shift.cashierId ||
          shift.cashierId === actor.sub);

      if (!canAttach) {
        throw new BadRequestException(
          'Provided shiftId is invalid, closed, or not accessible',
        );
      }
      shiftId = shift.id;
    } else {
      const { start: startOfToday, nextStart: nextDayStart } =
        getDhakaDayRange(operationTime);
      const shift = await tx.shiftSession.findFirst({
        where: {
          businessId,
          cashierId: actor.sub,
          status: ShiftStatus.OPEN,
          locationId,
          openedAt: {
            gte: startOfToday,
            lt: nextDayStart,
          },
        },
        orderBy: { openedAt: 'desc' },
        select: { id: true },
      });
      shiftId = shift?.id ?? null;
    }

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
        include: {
          product: {
            select: {
              id: true,
              name: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!variant) {
        throw new NotFoundException('Variant not found');
      }
      if (
        !variant.isActive ||
        (variant.product &&
          (!variant.product.isActive || variant.product.deletedAt !== null))
      ) {
        throw new BadRequestException(
          `Variant "${variant.name}" is no longer available for sale`,
        );
      }
      let previousStock = 0;
      let resultingStock = 0;
      if ((tx as any).locationStock && locationId) {
        const locStock = await (tx as any).locationStock.findUnique({
          where: { locationId_variantId: { locationId, variantId: vId } },
        });
        previousStock = locStock?.stock ?? 0;

        // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode.
        if (locStock) {
          const updated = await (tx as any).locationStock.update({
            where: { id: locStock.id },
            data: { stock: { decrement: totalQty } },
            select: { stock: true },
          });
          resultingStock = updated.stock;
        } else {
          const updated = await (tx as any).locationStock.upsert({
            where: { locationId_variantId: { locationId, variantId: vId } },
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

    const isExplicitShift =
      typeof dto.shiftId === 'string' && dto.shiftId.trim() !== '';
    if (shiftId) {
      if (tx.shiftSession?.updateMany) {
        const res = await tx.shiftSession.updateMany({
          where: { id: shiftId, status: ShiftStatus.OPEN },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
        if (res.count === 0) {
          if (isExplicitShift) {
            throw new ConflictException(
              'Register shift is closed or inactive. Cash sale requires an open shift.',
            );
          }
          shiftId = null;
        }
      } else if (tx.shiftSession?.update) {
        await tx.shiftSession.update({
          where: { id: shiftId },
          data: {
            cashCollected: { increment: totalAmount },
          },
        });
      }
    }

    const order = await tx.order.create({
      data: {
        invoiceNumber: receiptNumber,
        receiptNumber,
        occurredAt: operationTime,
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
    const businessId = requireBusinessId(actor, query.businessId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: any = {
      cashier: { businessId },
      ...(actor.role === Role.CASHIER
        ? { locationId: actor.locationId }
        : query.locationId
          ? { locationId: query.locationId }
          : {}),
    };
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
        customerName: order.customerName || 'Walk-in Customer',
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
