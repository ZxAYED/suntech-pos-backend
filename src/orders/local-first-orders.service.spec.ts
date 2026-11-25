jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderType, PaymentMethod, Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  LocalFirstOrdersService,
  computeLocalFirstHash,
} from './local-first-orders.service';
import { SyncV2OrderDto } from './dto/sync-v2.dto';

const actor = {
  sub: 'cashier-1',
  role: Role.CASHIER,
  businessId: 'biz-1',
  locationId: 'loc-1',
};
const scope = { deviceId: 'till-1', businessId: 'biz-1', locationId: 'loc-1' };
function sale(patch: Partial<SyncV2OrderDto> = {}): SyncV2OrderDto {
  return {
    clientOrderId: randomUUID(),
    userId: actor.sub,
    orderType: OrderType.CATALOG,
    occurredAt: new Date().toISOString(),
    shiftId: null,
    paymentMethod: PaymentMethod.COD,
    tenderedAmount: 100,
    pricePolicy: 'CURRENT_PRICE',
    grantToken: 'original.verified.grant',
    lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 100 }],
    ...patch,
  };
}
function fixture() {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    idempotencyRecord: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    financialSaleIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
    variant: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'variant-1', name: 'Original variant', sellingPrice: 100 },
        ]),
    },
    shiftSession: { findFirst: jest.fn().mockResolvedValue({ id: 'shift-1' }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  const receipt = {
    id: 'official-order-1',
    invoiceNumber: 'INV-1',
    totalAmount: 100,
    lines: [
      {
        id: 'official-line-1',
        variantId: 'variant-1',
        quantity: 1,
        unitPrice: 100,
      },
    ],
  };
  const orders = {
    createCatalogOrder: jest.fn().mockResolvedValue(receipt),
    createCustomOrder: jest.fn().mockResolvedValue(receipt),
  };
  const capabilities = {
    assertLiveScope: jest.fn().mockResolvedValue(scope),
    verifyEvent: jest.fn().mockResolvedValue({
      jti: 'grant-1',
      closedShiftPolicy: 'REVIEW',
      permissions: ['CATALOG_SALE', 'CUSTOM_SALE'],
    }),
  };
  const config = { get: jest.fn() };
  const service = new LocalFirstOrdersService(
    prisma as never,
    orders as never,
    capabilities as never,
    config as unknown as ConfigService,
  );
  return { service, prisma, orders, capabilities, receipt, config };
}

describe('LocalFirstOrdersService versioned contract', () => {
  it('keeps explicit live pricing separate from purchase identity and includes Admin-selected scope in execution', async () => {
    const { service, orders } = fixture();
    const admin = { ...actor, role: Role.ADMIN };
    const item = sale();
    const response = await service.sync(admin, { ...scope, orders: [item] });
    expect(response.results[0]).toMatchObject({
      clientOrderId: item.clientOrderId,
      status: 'ACCEPTED',
      retryable: false,
      orderId: 'official-order-1',
    });
    expect(orders.createCatalogOrder).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        businessId: 'biz-1',
        locationId: 'loc-1',
        shiftId: null,
      }),
      expect.objectContaining({
        executionMode: 'LOCAL_FIRST',
        pricePolicy: 'CURRENT_PRICE',
        syncProtocol: 2,
        clientOrderId: item.clientOrderId,
      }),
    );
  });

  it('returns individual results for mixed valid, invalid and temporarily unavailable sales', async () => {
    const { service, orders } = fixture();
    orders.createCatalogOrder.mockRejectedValueOnce(
      new Error('database connection lost'),
    );
    const items = [sale(), sale({ tenderedAmount: 1 }), sale()];
    const response = await service.sync(actor, { ...scope, orders: items });
    expect(
      response.results.map((result) => [result.status, result.retryable]),
    ).toEqual([
      ['REJECTED', true],
      ['REJECTED', false],
      ['ACCEPTED', false],
    ]);
    expect(response.results[0].code).toBe('SERVER_UNAVAILABLE');
    expect(response.results[1].code).toBe('TENDER_TOO_LOW');
    expect(orders.createCatalogOrder).toHaveBeenCalledTimes(2);
  });

  it('replays the exact durable official receipt without requiring a still-current selling grant', async () => {
    const { service, prisma, orders, receipt, capabilities } = fixture();
    const item = sale();
    prisma.order.findUnique.mockResolvedValue({
      id: receipt.id,
      invoiceNumber: receipt.invoiceNumber,
      cashierId: actor.sub,
      deviceId: scope.deviceId,
      locationId: scope.locationId,
      location: { businessId: scope.businessId },
      syncProtocol: 2,
      syncPayloadHash: computeLocalFirstHash(item, scope),
      syncReceipt: receipt,
      syncWarnings: ['LOW_STOCK_AFTER_SALE'],
    });
    const result = (await service.sync(actor, { ...scope, orders: [item] }))
      .results[0];
    expect(result).toMatchObject({
      status: 'DUPLICATE',
      order: receipt,
      warnings: ['LOW_STOCK_AFTER_SALE'],
    });
    expect(capabilities.verifyEvent).not.toHaveBeenCalled();
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it('refuses changed immutable payload under a previously accepted ID', async () => {
    const { service, prisma, orders, receipt } = fixture();
    const item = sale();
    prisma.order.findUnique.mockResolvedValue({
      id: receipt.id,
      cashierId: actor.sub,
      deviceId: scope.deviceId,
      locationId: scope.locationId,
      location: { businessId: scope.businessId },
      syncProtocol: 2,
      syncPayloadHash: computeLocalFirstHash(item, scope),
      syncReceipt: receipt,
    });
    const changed = { ...item, notes: 'Changed after collecting money' };
    expect(
      (await service.sync(actor, { ...scope, orders: [changed] })).results[0],
    ).toMatchObject({
      status: 'REJECTED',
      code: 'SYNC_PAYLOAD_MISMATCH',
      retryable: false,
    });
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it('keeps CURRENT_PRICE rejection machine-readable and does not substitute a captured price', async () => {
    const { service, orders } = fixture();
    orders.createCatalogOrder.mockRejectedValue(
      new ConflictException({
        code: 'PRICE_CHANGED',
        message: 'Price changed',
        submittedPrice: 100,
        currentPrice: 120,
      }),
    );
    expect(
      (await service.sync(actor, { ...scope, orders: [sale()] })).results[0],
    ).toMatchObject({
      status: 'REJECTED',
      code: 'PRICE_CHANGED',
      retryable: false,
    });
  });

  it('does not upload another cashier’s original sale as the current Admin seller', async () => {
    const { service, orders } = fixture();
    const result = await service.sync(
      { ...actor, sub: 'manager-1', role: Role.ADMIN },
      { ...scope, orders: [sale()] },
    );
    expect(result.results[0]).toMatchObject({
      code: 'ORIGINAL_OPERATOR_REQUIRED',
      retryable: false,
    });
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it('does not transplant an unresolved legacy key into a new synchronization purchase', async () => {
    const { service, prisma, orders } = fixture();
    prisma.idempotencyRecord.findFirst.mockResolvedValue({
      id: 'legacy-pending',
    });
    expect(
      (await service.sync(actor, { ...scope, orders: [sale()] })).results[0],
    ).toMatchObject({
      code: 'LEGACY_OPERATION_REVIEW_REQUIRED',
      retryable: false,
    });
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it('maps a concurrent winner to its saved receipt instead of inserting a second effect', async () => {
    const { service, prisma, orders, receipt } = fixture();
    const item = sale();
    prisma.order.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
      id: receipt.id,
      invoiceNumber: receipt.invoiceNumber,
      cashierId: actor.sub,
      deviceId: scope.deviceId,
      locationId: scope.locationId,
      location: { businessId: scope.businessId },
      syncProtocol: 2,
      syncPayloadHash: computeLocalFirstHash(item, scope),
      syncReceipt: receipt,
      syncWarnings: [],
    });
    orders.createCatalogOrder.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['clientOrderId'] },
      }),
    );
    expect(
      (await service.sync(actor, { ...scope, orders: [item] })).results[0],
    ).toMatchObject({ status: 'DUPLICATE', orderId: receipt.id });
    expect(orders.createCatalogOrder).toHaveBeenCalledTimes(1);
  });

  it('honors zero configured future skew instead of replacing zero with 300', async () => {
    const { service, config, orders } = fixture();
    config.get.mockReturnValue(0);
    const item = sale({
      occurredAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(
      (await service.sync(actor, { ...scope, orders: [item] })).results[0],
    ).toMatchObject({ code: 'TIMESTAMP_FUTURE_REVIEW_REQUIRED' });
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['missing shift', { shiftId: undefined }],
    ['missing payment', { paymentMethod: undefined }],
    ['fractional tender', { tenderedAmount: 100.5 }],
    ['overflow tender', { tenderedAmount: 2147483648 }],
    ['timezone missing', { occurredAt: '2026-11-24T10:00:00' }],
  ])('keeps invalid %s from financial execution', async (_name, patch) => {
    const { service, orders } = fixture();
    const item = sale(patch as Partial<SyncV2OrderDto>);
    if (patch.shiftId === undefined && _name === 'missing shift')
      delete item.shiftId;
    expect(
      (await service.sync(actor, { ...scope, orders: [item] })).results[0]
        .status,
    ).toBe('REJECTED');
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });

  it('applies the 100 limit to each HTTP request, accepting later requests without a total queue cap', async () => {
    const { service, orders } = fixture();
    const first = await service.sync(actor, {
      ...scope,
      orders: Array.from({ length: 100 }, () => sale()),
    });
    const next = await service.sync(actor, { ...scope, orders: [sale()] });
    expect(first.results).toHaveLength(100);
    expect(next.results[0].status).toBe('ACCEPTED');
    expect(orders.createCatalogOrder).toHaveBeenCalledTimes(101);
    await expect(
      service.sync(actor, {
        ...scope,
        orders: Array.from({ length: 101 }, () => sale()),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retains the original online PRICE_CHANGED correction before local commit using a read-only preflight', async () => {
    const { service, prisma, orders } = fixture();
    prisma.variant.findMany.mockResolvedValue([
      { id: 'variant-1', name: 'Blue', sellingPrice: 120 },
    ]);
    await expect(
      service.validateCurrent(actor, {
        ...scope,
        orderType: OrderType.CATALOG,
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 100,
        shiftId: null,
        lines: [{ variantId: 'variant-1', unitPrice: 100, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'PRICE_CHANGED',
        currentPrice: 120,
        submittedPrice: 100,
      },
    });
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
    expect(prisma.financialSaleIdentity.findUnique).not.toHaveBeenCalled();
  });

  it('stops an unauthorized entire pass without discarding or attributing its events', async () => {
    const { service, capabilities, orders } = fixture();
    capabilities.assertLiveScope.mockRejectedValue(
      new ForbiddenException('Branch changed'),
    );
    await expect(
      service.sync(actor, { ...scope, orders: [sale()] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.createCatalogOrder).not.toHaveBeenCalled();
  });
});
