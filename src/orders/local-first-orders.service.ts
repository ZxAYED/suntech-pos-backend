import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderType, Prisma, Role, ShiftStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'node:crypto';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { parseStrictEventInstant } from '../common/utils/timezone.util';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { OfflineCapabilityService } from '../offline/offline-capability.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SyncV2OrderDto,
  SyncV2OrdersDto,
  SyncV2StatusDto,
  ValidateLocalSaleDto,
} from './dto/sync-v2.dto';
import { assertTender, lineTotal, sumMoney } from './money';
import { OrdersService, type OfflineOrderOptions } from './order.service';
import {
  computeSyncPayloadHash,
  deterministicStringify,
} from './sync-payload-hash';

export type LocalFirstResult = {
  clientOrderId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  retryable: boolean;
  code?: string;
  error?: string;
  warnings: string[];
  orderId?: string;
  invoiceNumber?: string;
  order?: unknown;
};

export function computeLocalFirstHash(
  item: SyncV2OrderDto,
  scope: { deviceId: string; businessId: string; locationId: string },
): string {
  const base = computeSyncPayloadHash({
    ...item,
    ...scope,
    cashierId: item.userId,
  });
  return `v2:${createHash('sha256')
    .update(
      deterministicStringify({
        base,
        version: 2,
        pricePolicy: item.pricePolicy,
        grantToken: item.grantToken,
      }),
    )
    .digest('hex')}`;
}

export function localFirstError(error: unknown): {
  code: string;
  error: string;
  retryable: boolean;
} {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const body =
      typeof response === 'object' ? (response as Record<string, unknown>) : {};
    const status = error.getStatus();
    return {
      code:
        typeof body.code === 'string'
          ? body.code
          : status === 401 || status === 403
            ? 'AUTHORIZATION_REQUIRED'
            : status === 429
              ? 'RATE_LIMITED'
              : status >= 500
                ? 'SERVER_UNAVAILABLE'
                : status === 404
                  ? 'ITEM_UNAVAILABLE'
                  : status === 409
                    ? 'ORDER_CONFLICT'
                    : 'VALIDATION_ERROR',
      error: typeof body.message === 'string' ? body.message : error.message,
      retryable:
        status >= 500 ||
        status === 429 ||
        (status === 409 && error.message.includes('Retry')),
    };
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  )
    return {
      code: 'TRANSACTION_RETRY',
      error: 'The database was busy. Retry this same sale identity.',
      retryable: true,
    };
  // Unexpected failures can occur after the response path becomes uncertain. Never tell the client to discard/re-key.
  return {
    code: 'SERVER_UNAVAILABLE',
    error:
      'The outcome could not be confirmed. Retry the same saved sale identity.',
    retryable: true,
  };
}

const replaySelect = {
  id: true,
  invoiceNumber: true,
  clientOrderId: true,
  cashierId: true,
  deviceId: true,
  locationId: true,
  syncPayloadHash: true,
  syncProtocol: true,
  syncReceipt: true,
  syncWarnings: true,
  location: { select: { businessId: true } },
} satisfies Prisma.OrderSelect;
type ReplayOrder = Prisma.OrderGetPayload<{ select: typeof replaySelect }>;

@Injectable()
export class LocalFirstOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly capabilities: OfflineCapabilityService,
    private readonly config: ConfigService,
  ) {}

  /** Read-only preflight: retains the existing live PRICE_CHANGED correction flow. */
  async validateCurrent(actor: AccessTokenPayload, dto: ValidateLocalSaleDto) {
    await this.capabilities.assertLiveScope(actor, dto);
    if (dto.userId && dto.userId !== actor.sub)
      throw new ForbiddenException('Original operator mismatch');
    assertTender(dto.tenderedAmount);
    const total = sumMoney(
      dto.lines.map((line) => lineTotal(line.unitPrice, line.quantity)),
    );
    if (dto.tenderedAmount < total)
      throw new BadRequestException('Tendered amount is less than the total');
    await this.prisma.$transaction(
      async (tx) => {
        if (dto.orderType === OrderType.CATALOG) {
          if (dto.lines.some((line) => !line.variantId))
            throw new BadRequestException(
              'Each catalog line needs its original variant ID',
            );
          const variants = await tx.variant.findMany({
            where: {
              id: { in: dto.lines.map((line) => line.variantId!) },
              businessId: dto.businessId,
              isActive: true,
              deletedAt: null,
              product: {
                businessId: dto.businessId,
                isActive: true,
                deletedAt: null,
              },
            },
            select: { id: true, name: true, sellingPrice: true },
          });
          const indexed = new Map(
            variants.map((variant) => [variant.id, variant]),
          );
          for (const line of dto.lines) {
            const variant = indexed.get(line.variantId!);
            if (!variant)
              throw new NotFoundException(
                'Variant is unavailable for online sale',
              );
            if (variant.sellingPrice !== line.unitPrice)
              throw new ConflictException({
                code: 'PRICE_CHANGED',
                message: `Price for variant "${variant.name}" has changed from ${line.unitPrice} to ${variant.sellingPrice}`,
                variantId: variant.id,
                submittedPrice: line.unitPrice,
                currentPrice: variant.sellingPrice,
              });
          }
        } else if (
          dto.lines.some((line) => !line.productName?.trim() || line.variantId)
        )
          throw new BadRequestException(
            'Custom items need a title and cannot reference a variant',
          );
        if (dto.shiftId) {
          const shift = await tx.shiftSession.findFirst({
            where: {
              id: dto.shiftId,
              businessId: dto.businessId,
              locationId: dto.locationId,
              status: ShiftStatus.OPEN,
              ...(actor.role === Role.CASHIER ? { cashierId: actor.sub } : {}),
            },
            select: { id: true },
          });
          if (!shift)
            throw new BadRequestException(
              'Provided shiftId is invalid, closed, or not accessible',
            );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      valid: true,
      pricePolicy: 'CURRENT_PRICE' as const,
      serverTime: new Date().toISOString(),
    };
  }

  private replay(
    existing: ReplayOrder,
    hash: string,
    actor: AccessTokenPayload,
    scope: { deviceId: string; businessId: string; locationId: string },
    clientOrderId: string,
  ): LocalFirstResult {
    if (
      existing.cashierId !== actor.sub ||
      existing.deviceId !== scope.deviceId ||
      existing.locationId !== scope.locationId ||
      existing.location.businessId !== scope.businessId
    )
      return {
        clientOrderId,
        status: 'REJECTED',
        retryable: false,
        code: 'SYNC_IDENTITY_CONFLICT',
        error: 'This identity belongs to a different original sale context.',
        warnings: [],
      };
    if (
      existing.syncProtocol !== 2 ||
      existing.syncPayloadHash !== hash ||
      !existing.syncReceipt
    )
      return {
        clientOrderId,
        status: 'REJECTED',
        retryable: false,
        code:
          existing.syncProtocol !== 2
            ? 'LEGACY_OPERATION_REVIEW_REQUIRED'
            : 'SYNC_PAYLOAD_MISMATCH',
        error:
          'The original sale identity or saved payload differs. Keep the original event for review.',
        warnings: [],
      };
    return {
      clientOrderId,
      status: 'DUPLICATE',
      retryable: false,
      orderId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      order: existing.syncReceipt,
      warnings: Array.isArray(existing.syncWarnings)
        ? existing.syncWarnings.filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    };
  }

  async sync(
    actor: AccessTokenPayload,
    dto: SyncV2OrdersDto,
  ): Promise<{ serverTime: string; results: LocalFirstResult[] }> {
    await this.capabilities.assertLiveScope(actor, dto);
    if (
      !Array.isArray(dto.orders) ||
      dto.orders.length < 1 ||
      dto.orders.length > 100
    )
      throw new BadRequestException(
        'A sync request must contain between 1 and 100 sales. Additional requests have no total sale-count limit.',
      );
    const serverTime = new Date();
    const rawSkew =
      this.config.get<string | number>('OFFLINE_MAX_FUTURE_SKEW_SECONDS') ??
      process.env.OFFLINE_MAX_FUTURE_SKEW_SECONDS;
    const parsedSkew =
      rawSkew === undefined || rawSkew === '' ? 300 : Number(rawSkew);
    const maxFutureSkewSeconds =
      Number.isFinite(parsedSkew) && parsedSkew >= 0
        ? Math.floor(parsedSkew)
        : 300;
    const results: LocalFirstResult[] = [];
    for (const raw of dto.orders) {
      const clientOrderId =
        typeof raw?.clientOrderId === 'string' ? raw.clientOrderId : '';
      let hash: string | undefined;
      try {
        const item = plainToInstance(SyncV2OrderDto, raw);
        const validation = await validate(item, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        if (
          validation.length ||
          !Object.prototype.hasOwnProperty.call(raw, 'shiftId')
        )
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message:
              'The sale must contain valid frozen fields, a payment method, and an explicit shiftId (null if no shift).',
          });
        if (!item.paymentMethod)
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'An explicit payment method is required.',
          });
        if (item.userId !== actor.sub)
          throw new ForbiddenException({
            code: 'ORIGINAL_OPERATOR_REQUIRED',
            message:
              'Sign in as the original seller. Recovery by another operator needs an approved separate workflow.',
          });
        if (
          item.orderType === OrderType.CATALOG &&
          item.lines.some((line) => !line.variantId)
        )
          throw new BadRequestException({
            code: 'VARIANT_REQUIRED',
            message: 'Every catalog line needs its original real variant ID.',
          });
        if (
          item.orderType === OrderType.CUSTOM &&
          item.lines.some((line) => !line.productName?.trim() || line.variantId)
        )
          throw new BadRequestException({
            code: 'CUSTOM_LINE_INVALID',
            message:
              'Custom sale lines need a title and cannot reference a catalog variant.',
          });
        const instant = parseStrictEventInstant(item.occurredAt);
        if (!instant.isValid || !instant.date)
          throw new BadRequestException({
            code:
              instant.errorType === 'TIMEZONE_REQUIRED'
                ? 'TIMESTAMP_TIMEZONE_REQUIRED'
                : 'TIMESTAMP_INVALID',
            message:
              'The original sale time needs a valid UTC offset or Z timezone.',
          });
        assertTender(item.tenderedAmount);
        const total = sumMoney(
          item.lines.map((line) => lineTotal(line.unitPrice, line.quantity)),
        );
        if (item.tenderedAmount < total)
          throw new BadRequestException({
            code: 'TENDER_TOO_LOW',
            message: 'Tendered amount is below the frozen sale total.',
          });
        hash = computeLocalFirstHash(item, dto);
        const existing = await this.prisma.order.findUnique({
          where: { clientOrderId },
          select: replaySelect,
        });
        if (existing) {
          results.push(this.replay(existing, hash, actor, dto, clientOrderId));
          continue;
        }
        const legacy = await this.prisma.idempotencyRecord.findFirst({
          where: {
            key: clientOrderId,
            scopeId: { in: [actor.sub, `${actor.sub}:${dto.businessId}`] },
            path: {
              in: [
                '/api/v1/orders',
                '/api/v1/orders/catalog',
                '/api/v1/orders/custom',
                '/orders',
                '/orders/catalog',
                '/orders/custom',
              ],
            },
          },
          select: { id: true },
        });
        const identity = await this.prisma.financialSaleIdentity.findUnique({
          where: { id: clientOrderId },
        });
        if (legacy || (identity && identity.protocol !== 'LOCAL_FIRST_V2'))
          throw new ForbiddenException({
            code: 'LEGACY_OPERATION_REVIEW_REQUIRED',
            message:
              'This purchase already has legacy HTTP recovery evidence. Continue recovery on its original route.',
          });
        if (
          instant.date.getTime() - serverTime.getTime() >
          maxFutureSkewSeconds * 1000
        )
          throw new BadRequestException({
            code: 'TIMESTAMP_FUTURE_REVIEW_REQUIRED',
            message:
              'Recorded sale time exceeds the allowed future clock difference.',
          });
        const claims = await this.capabilities.verifyEvent(
          item.grantToken,
          {
            userId: item.userId,
            deviceId: dto.deviceId,
            businessId: dto.businessId,
            locationId: dto.locationId,
          },
          instant.date,
          item.pricePolicy,
        );
        const requiredPermission =
          item.orderType === OrderType.CATALOG ? 'CATALOG_SALE' : 'CUSTOM_SALE';
        if (!claims.permissions.includes(requiredPermission)) {
          throw new ForbiddenException({
            code: 'OFFLINE_ACTION_NOT_ALLOWED',
            message:
              'The original permission does not allow this type of sale.',
          });
        }
        const warnings: string[] =
          instant.date > serverTime ? ['CLOCK_SKEW_TOLERATED'] : [];
        const options: OfflineOrderOptions = {
          executionMode: 'LOCAL_FIRST',
          syncProtocol: 2,
          pricePolicy: item.pricePolicy,
          closedShiftPolicy: claims.closedShiftPolicy,
          clientOrderId,
          clientReceiptNumber: item.clientReceiptNumber,
          deviceId: dto.deviceId,
          occurredAt: instant.date,
          rawOccurredAt: item.occurredAt,
          syncPayloadHash: hash,
          warnings,
          syncAuditMetadata: {
            protocolVersion: 2,
            actorId: item.userId,
            uploaderId: actor.sub,
            businessId: dto.businessId,
            locationId: dto.locationId,
            deviceId: dto.deviceId,
            clientOrderId,
            grantId: claims.jti,
            pricePolicy: item.pricePolicy,
            closedShiftPolicy: claims.closedShiftPolicy,
            rawOccurredAt: item.occurredAt,
            normalizedOccurredAt: instant.date.toISOString(),
            serverReferenceTime: serverTime.toISOString(),
            warnings,
          },
        };
        const common = {
          businessId: dto.businessId,
          locationId: dto.locationId,
          shiftId: item.shiftId,
          tenderedAmount: item.tenderedAmount,
          paymentMethod: item.paymentMethod,
          customerName: item.customerName,
          customerPhone: item.customerPhone,
          notes: item.notes,
        };
        const order =
          item.orderType === OrderType.CATALOG
            ? await this.orders.createCatalogOrder(
                actor,
                {
                  ...common,
                  lines: item.lines.map((line) => ({
                    ...line,
                    variantId: line.variantId!,
                  })),
                },
                options,
              )
            : await this.orders.createCustomOrder(
                actor,
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
          clientOrderId,
          status: 'ACCEPTED',
          retryable: false,
          orderId: order.id,
          invoiceNumber: order.invoiceNumber,
          order,
          warnings,
        });
      } catch (error) {
        if (hash && isUniqueConstraintError(error)) {
          // An overlapping tab/device may have committed while we were validating.
          try {
            const winner = await this.prisma.order.findUnique({
              where: { clientOrderId },
              select: replaySelect,
            });
            if (winner) {
              results.push(
                this.replay(winner, hash, actor, dto, clientOrderId),
              );
              continue;
            }
            const identity = await this.prisma.financialSaleIdentity.findUnique(
              { where: { id: clientOrderId } },
            );
            if (identity?.protocol === 'LEGACY_HTTP') {
              results.push({
                clientOrderId,
                status: 'REJECTED',
                retryable: false,
                code: 'LEGACY_OPERATION_REVIEW_REQUIRED',
                error: 'A legacy request already owns this purchase identity.',
                warnings: [],
              });
              continue;
            }
          } catch {
            /* Preserve uncertainty through the retryable result below. */
          }
        }
        results.push({
          clientOrderId,
          status: 'REJECTED',
          warnings: [],
          ...localFirstError(error),
        });
      }
    }
    return { serverTime: serverTime.toISOString(), results };
  }

  async status(actor: AccessTokenPayload, dto: SyncV2StatusDto) {
    await this.capabilities.assertLiveScope(actor, dto);
    const orders = await this.prisma.order.findMany({
      where: {
        clientOrderId: { in: dto.clientOrderIds },
        cashierId: actor.sub,
        deviceId: dto.deviceId,
        locationId: dto.locationId,
        location: { businessId: dto.businessId },
        syncProtocol: 2,
      },
      select: replaySelect,
    });
    const indexed = new Map(
      orders.map((order) => [order.clientOrderId, order]),
    );
    return {
      serverTime: new Date().toISOString(),
      results: dto.clientOrderIds.map((clientOrderId) => {
        const order = indexed.get(clientOrderId);
        return order && order.syncReceipt
          ? {
              clientOrderId,
              status: 'ACCEPTED' as const,
              order: order.syncReceipt,
              orderId: order.id,
              invoiceNumber: order.invoiceNumber,
              warnings: order.syncWarnings ?? [],
              payloadHash: order.syncPayloadHash,
            }
          : { clientOrderId, status: 'NOT_FOUND' as const };
      }),
    };
  }

  async legacyStatus(actor: AccessTokenPayload, key: string) {
    if (!key || key.length > 200)
      throw new BadRequestException('Invalid recovery key');
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scopeId_key: {
          scopeId: `${actor.sub}${actor.businessId ? `:${actor.businessId}` : ''}`,
          key,
        },
      },
    });
    if (!record || !/\/orders(?:\/(?:catalog|custom))?$/.test(record.path))
      return { status: 'NOT_FOUND', canCreateReplacement: false };
    return record.statusCode === 0
      ? {
          status: 'UNKNOWN',
          canCreateReplacement: false,
          originalPath: record.path,
        }
      : {
          status: 'CONFIRMED',
          canCreateReplacement: false,
          originalPath: record.path,
          response: record.responseBody,
        };
  }
}
