import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { OrdersService } from './order.service';

describe('OrdersService', () => {
  const userFindFirst = jest.fn();
  const locationFindFirst = jest.fn();
  const shiftFindFirst = jest.fn();
  const shiftUpdate = jest.fn();
  const variantFindMany = jest.fn();
  const variantFindFirst = jest.fn();
  const variantUpdate = jest.fn();
  const variantUpdateMany = jest.fn();
  const stockCreate = jest.fn();
  const orderCreate = jest.fn();
  const orderCount = jest.fn();
  const orderFindMany = jest.fn();
  const orderFindUnique = jest.fn();
  const auditCreate = jest.fn();
  const locationStockFindUnique = jest.fn();
  const locationStockUpdate = jest.fn();
  const locationStockUpdateMany = jest.fn();
  const locationStockUpsert = jest.fn();
  const locationStockCreate = jest.fn();

  const tx = {
    user: { findFirst: userFindFirst },
    location: { findFirst: locationFindFirst },
    shiftSession: { findFirst: shiftFindFirst, update: shiftUpdate },
    variant: {
      findMany: variantFindMany,
      findFirst: variantFindFirst,
      update: variantUpdate,
      updateMany: variantUpdateMany,
    },
    stockTransaction: { create: stockCreate },
    order: {
      create: orderCreate,
      count: orderCount,
      findMany: orderFindMany,
      findUnique: orderFindUnique,
    },
    auditLog: { create: auditCreate },
    locationStock: {
      findUnique: locationStockFindUnique,
      update: locationStockUpdate,
      updateMany: locationStockUpdateMany,
      upsert: locationStockUpsert,
      create: locationStockCreate,
    },
  };

  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
    user: { findFirst: userFindFirst },
    order: {
      count: orderCount,
      findMany: orderFindMany,
      findUnique: orderFindUnique,
    },
  };

  const service = new OrdersService(prisma as never);

  const cashierUser = {
    id: 'user-cashier-1',
    role: Role.CASHIER,
    businessId: 'biz-1',
    locationId: 'loc-1',
    deletedAt: null,
  };

  const adminUser = {
    id: 'user-admin-1',
    role: Role.ADMIN,
    businessId: 'biz-1',
    ownedBusinesses: [{ id: 'biz-1' }],
    deletedAt: null,
  };

  const validLocation = {
    id: 'loc-1',
    businessId: 'biz-1',
    deletedAt: null,
  };

  const openShift = {
    id: 'shift-1',
    businessId: 'biz-1',
    locationId: 'loc-1',
    cashierId: 'user-cashier-1',
    status: ShiftStatus.OPEN,
  };

  const mockCatalogVariant = {
    id: 'variant-1',
    name: '128GB Black',
    stock: 10,
    sellingPrice: 1500,
    isActive: true,
    product: {
      id: 'prod-1',
      name: 'iPhone 15',
      isActive: true,
      deletedAt: null,
      category: null,
    },
    locationStocks: [{ id: 'ls-1', stock: 10 }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userFindFirst.mockResolvedValue(cashierUser);
    locationFindFirst.mockResolvedValue(validLocation);
    shiftFindFirst.mockResolvedValue(openShift);
    shiftUpdate.mockResolvedValue({ id: 'shift-1', cashCollected: 3000 });
    variantUpdate.mockResolvedValue({ id: 'variant-1', stock: 8 });
    variantUpdateMany.mockResolvedValue({ count: 1 });
    stockCreate.mockResolvedValue({ id: 'stock-1' });
    auditCreate.mockResolvedValue({ id: 'audit-1' });
    orderFindUnique.mockResolvedValue(null);
    locationStockFindUnique.mockResolvedValue(null);
    locationStockUpdate.mockResolvedValue({ stock: 8 });
    locationStockUpdateMany.mockResolvedValue({ count: 1 });
    variantFindMany.mockResolvedValue([mockCatalogVariant]);
    locationStockUpsert.mockImplementation(
      ({ create }: { create: { stock: number } }) =>
        Promise.resolve({ stock: create.stock }),
    );
    locationStockCreate.mockImplementation(
      ({ data }: { data: { stock: number } }) =>
        Promise.resolve({ stock: data.stock }),
    );
    orderCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'order-1', ...data }),
    );
  });

  describe('createCatalogOrder (Flow 1)', () => {
    it('successfully processes a catalog order with stock decrement and shift increment', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      const result = await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        tenderedAmount: 3500,
        customerName: 'Rahim Khan',
        customerPhone: '01711111111',
        notes: 'IMEI: 123456789',
        lines: [
          {
            variantId: 'variant-1',
            quantity: 2,
            unitPrice: 1500,
          },
        ],
      });

      expect(variantFindMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['variant-1'] },
          businessId: 'biz-1',
          deletedAt: null,
          product: { businessId: 'biz-1', deletedAt: null },
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
            where: { locationId: 'loc-1' },
            select: { id: true, stock: true },
          },
        },
      });

      // Verify stock was decremented
      expect(variantUpdate).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { stock: { decrement: 2 } },
      });

      // Verify StockTransaction was recorded
      expect(stockCreate).toHaveBeenCalledWith({
        data: {
          variantId: 'variant-1',
          locationId: 'loc-1',
          type: StockTransactionType.SALE,
          quantity: 2,
          notes: expect.stringMatching(/^INV-\d{8}-[A-Z0-9]{4}$/),
        },
      });

      // Verify shift cash increment
      expect(shiftUpdate).toHaveBeenCalledWith({
        where: { id: 'shift-1' },
        data: { cashCollected: { increment: 3000 } },
      });

      // Verify Order creation
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderType: OrderType.CATALOG,
            status: OrderStatus.PAID,
            locationId: 'loc-1',
            shiftId: 'shift-1',
            cashierId: 'user-cashier-1',
            subtotal: 3000,
            totalAmount: 3000,
            tenderedAmount: 3500,
            changeDue: 500,
            customerName: 'Rahim Khan',
            customerPhone: '01711111111',
            notes: 'IMEI: 123456789',
            paymentMethod: PaymentMethod.COD,
            lines: {
              create: [
                {
                  variantId: 'variant-1',
                  productName: 'iPhone 15',
                  variantName: '128GB Black',
                  unitPrice: 1500,
                  unitCost: null,
                  categoryName: 'Uncategorized',
                  quantity: 2,
                  subtotal: 3000,
                },
              ],
            },
          }),
        }),
      );

      expect(result).toBeDefined();
    });

    it('supports non-COD payment methods like BKASH or BANK for catalog orders', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        tenderedAmount: 1500,
        paymentMethod: PaymentMethod.BKASH,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: PaymentMethod.BKASH,
          }),
        }),
      );
    });

    it('rejects online catalog order when stock is insufficient and does not allow negative stock', async () => {
      variantFindMany.mockResolvedValueOnce([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 1, // Insufficient for quantity 2
          sellingPrice: 1500,
          isActive: true,
          product: {
            id: 'prod-1',
            name: 'iPhone 15',
            isActive: true,
            deletedAt: null,
          },
          locationStocks: [{ id: 'ls-1', stock: 1 }],
        },
      ]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 3000,
          lines: [{ variantId: 'variant-1', quantity: 2, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(variantUpdate).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('rejects online catalog order when concurrent checkout exhausts stock (atomic conflict)', async () => {
      locationStockUpdateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 3000,
          lines: [{ variantId: 'variant-1', quantity: 2, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(ConflictException);

      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('rejects online catalog order when variant is inactive', async () => {
      variantFindMany.mockResolvedValueOnce([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          isActive: false,
          product: {
            id: 'prod-1',
            name: 'iPhone 15',
            isActive: true,
            deletedAt: null,
          },
          locationStocks: [{ id: 'ls-1', stock: 10 }],
        },
      ]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects online catalog order when product is inactive', async () => {
      variantFindMany.mockResolvedValueOnce([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          isActive: true,
          product: {
            id: 'prod-1',
            name: 'iPhone 15',
            isActive: false,
            deletedAt: null,
          },
          locationStocks: [{ id: 'ls-1', stock: 10 }],
        },
      ]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when variant is not found in the tenant', async () => {
      variantFindMany.mockResolvedValue([]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 3000,
          lines: [{ variantId: 'variant-999', quantity: 1, unitPrice: 1000 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when tenderedAmount is less than subtotal', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1000, // Less than 1500
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows cashier checkout without an open shift', async () => {
      shiftFindFirst.mockResolvedValue(null);
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shiftId: null }),
        }),
      );
    });

    it('allows Admin to sell without shiftId', async () => {
      userFindFirst.mockResolvedValue(adminUser);
      shiftFindFirst.mockResolvedValue(null);
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-admin-1', {
        locationId: 'loc-1',
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderType: OrderType.CATALOG,
            shiftId: null,
            cashierId: 'user-admin-1',
          }),
        }),
      );
    });

    it('ignores a payload location and uses the cashier token location', async () => {
      const cashierActor = {
        sub: 'user-cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-1',
      };

      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder(cashierActor, {
        locationId: 'loc-other',
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(locationFindFirst).toHaveBeenCalledWith({
        where: { id: 'loc-1', businessId: 'biz-1', deletedAt: null },
      });
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ locationId: 'loc-1' }),
        }),
      );
    });

    it('does not increment physical cash drawer when paymentMethod is digital (BKASH)', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        tenderedAmount: 1500,
        paymentMethod: PaymentMethod.BKASH,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: PaymentMethod.BKASH,
          }),
        }),
      );
    });
  });

  describe('createCustomOrder (Flow 2)', () => {
    it('bypasses catalog lookup and stock decrement while creating custom order', async () => {
      const result = await service.createCustomOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        tenderedAmount: 1000,
        customerName: 'Karim',
        customerPhone: '01822222222',
        notes: 'Screen replacement warranty 30 days',
        lines: [
          {
            productName: 'Screen Protector',
            variantName: 'Matte Finish',
            quantity: 2,
            unitPrice: 250,
          },
          {
            productName: 'Quick Back Cover Installation',
            quantity: 1,
            unitPrice: 500,
          },
        ],
      });

      // Assert NO catalog query was executed
      expect(variantFindMany).not.toHaveBeenCalled();
      expect(variantFindFirst).not.toHaveBeenCalled();

      // Assert NO stock was decremented
      expect(variantUpdate).not.toHaveBeenCalled();
      expect(stockCreate).not.toHaveBeenCalled();

      // Assert shift cash increment
      expect(shiftUpdate).toHaveBeenCalledWith({
        where: { id: 'shift-1' },
        data: { cashCollected: { increment: 1000 } },
      });

      // Assert Order created with orderType: CUSTOM and variantId: null
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceNumber: expect.stringMatching(/^INV-\d{8}-[A-Z0-9]{4}$/),
            orderType: OrderType.CUSTOM,
            status: OrderStatus.PAID,
            locationId: 'loc-1',
            shiftId: 'shift-1',
            cashierId: 'user-cashier-1',
            subtotal: 1000,
            totalAmount: 1000,
            tenderedAmount: 1000,
            changeDue: 0,
            customerName: 'Karim',
            customerPhone: '01822222222',
            notes: 'Screen replacement warranty 30 days',
            lines: {
              create: [
                {
                  variantId: null,
                  productName: 'Screen Protector',
                  variantName: 'Matte Finish',
                  unitPrice: 250,
                  unitCost: null,
                  categoryName: 'Uncategorized',
                  quantity: 2,
                  subtotal: 500,
                },
                {
                  variantId: null,
                  productName: 'Quick Back Cover Installation',
                  variantName: null,
                  unitPrice: 500,
                  unitCost: null,
                  categoryName: 'Uncategorized',
                  quantity: 1,
                  subtotal: 500,
                },
              ],
            },
          }),
        }),
      );

      expect(result).toBeDefined();
    });

    it('supports paymentType alias like NAGAD for custom orders', async () => {
      await service.createCustomOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        tenderedAmount: 500,
        paymentType: PaymentMethod.NAGAD,
        lines: [
          {
            productName: 'Fast repair',
            quantity: 1,
            unitPrice: 500,
          },
        ],
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: PaymentMethod.NAGAD,
          }),
        }),
      );
    });

    it('rejects custom order when tenderedAmount < subtotal', async () => {
      await expect(
        service.createCustomOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 200,
          lines: [
            {
              productName: 'Repair',
              quantity: 1,
              unitPrice: 500,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('syncOrders', () => {
    const actor = {
      sub: 'user-cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-1',
      locationId: 'loc-1',
    };

    it('returns independent accepted, duplicate, and rejected results', async () => {
      shiftFindFirst.mockResolvedValue(null);
      orderFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'order-existing',
        invoiceNumber: 'INV-OLD',
      });

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '11111111-1111-4111-8111-111111111111',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
          {
            clientOrderId: '22222222-2222-4222-8222-222222222222',
            occurredAt: '2026-10-24T13:31:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 200,
            lines: [{ productName: 'Cable', quantity: 1, unitPrice: 200 }],
          },
          {
            clientOrderId: 'not-a-uuid',
            occurredAt: '2026-10-24T13:32:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 100,
            lines: [{ productName: 'Invalid', quantity: 1, unitPrice: 100 }],
          },
        ],
      });

      expect(result.results.map((item) => item.status)).toEqual([
        'ACCEPTED',
        'DUPLICATE',
        'REJECTED',
      ]);
      expect(result.results[0].warnings).toContain('SHIFT_NOT_ATTACHED');
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          orderId: 'order-existing',
          invoiceNumber: 'INV-OLD',
        }),
      );
      expect(orderCreate).toHaveBeenCalledTimes(1);
      expect(variantFindMany).not.toHaveBeenCalled();
      expect(variantUpdate).not.toHaveBeenCalled();
    });

    it('honors offline price, accepts deleted variants, and audits low stock', async () => {
      const existingVariantId = '33333333-3333-4333-8333-333333333333';
      const deletedVariantId = '44444444-4444-4444-8444-444444444444';
      shiftFindFirst.mockResolvedValue(null);
      variantFindMany.mockResolvedValue([
        {
          id: existingVariantId,
          name: 'Blue',
          stock: 20,
          sellingPrice: 100,
          costPrice: 50,
          product: { name: 'Phone', category: { name: 'Devices' } },
          locationStocks: [{ id: 'ls-1', stock: 6 }],
        },
      ]);
      locationStockUpdate.mockResolvedValueOnce({ stock: 4 });

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '55555555-5555-4555-8555-555555555555',
            clientReceiptNumber: 'COUNTER-01-1',
            occurredAt: '2026-10-23T13:30:00+06:00',
            orderType: OrderType.CATALOG,
            tenderedAmount: 230,
            lines: [
              {
                variantId: existingVariantId,
                productName: 'Phone',
                variantName: 'Blue',
                quantity: 2,
                unitPrice: 90,
              },
              {
                variantId: deletedVariantId,
                productName: 'Old accessory',
                variantName: 'Cached',
                quantity: 1,
                unitPrice: 50,
              },
            ],
          },
        ],
      });

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          warnings: expect.arrayContaining([
            'SHIFT_NOT_ATTACHED',
            'OFFLINE_PRICE_MISMATCH',
            'VARIANT_UNAVAILABLE',
            'LOW_STOCK_AFTER_SALE',
          ]),
        }),
      );
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientReceiptNumber: 'COUNTER-01-1',
            totalAmount: 230,
            lines: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  variantId: existingVariantId,
                  unitPrice: 90,
                }),
                expect.objectContaining({
                  variantId: null,
                  productName: 'Old accessory',
                  unitPrice: 50,
                }),
              ]),
            },
          }),
        }),
      );
      expect(auditCreate.mock.calls.map(([arg]) => arg.data.action)).toEqual(
        expect.arrayContaining([
          'LOW_STOCK_AFTER_SALE',
          'OFFLINE_PRICE_MISMATCH',
          'VARIANT_UNAVAILABLE',
        ]),
      );
    });

    it('rejects an underpaid order without creating it', async () => {
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '66666666-6666-4666-8666-666666666666',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 99,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 100 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('rejects duplicate clientOrderId replay when payload is modified (F21)', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-123',
        invoiceNumber: 'INV-123',
        totalAmount: 1000,
        lines: [{ quantity: 1, unitPrice: 1000 }],
      });

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '77777777-7777-4777-8777-777777777777',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 2000,
            lines: [
              { productName: 'Different Item', quantity: 1, unitPrice: 2000 },
            ],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].error).toContain(
        'clientOrderId replay mismatch',
      );
    });
  });

  describe('getOrders', () => {
    it('retrieves orders with locationId and orderType filters', async () => {
      orderCount.mockResolvedValue(1);
      orderFindMany.mockResolvedValue([
        { id: 'order-1', orderType: OrderType.CATALOG },
      ]);

      const result = await service.getOrders({
        locationId: 'loc-1',
        orderType: OrderType.CATALOG,
        page: 1,
        limit: 10,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: { locationId: 'loc-1', orderType: OrderType.CATALOG },
      });
      expect(orderFindMany).toHaveBeenCalledWith({
        where: { locationId: 'loc-1', orderType: OrderType.CATALOG },
        select: expect.any(Object),
        orderBy: { occurredAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('scopes orders to cashier location and tenant when called by cashier', async () => {
      orderCount.mockResolvedValue(1);
      orderFindMany.mockResolvedValue([{ id: 'order-1' }]);

      const cashierActor = {
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-1',
      };

      const result = await service.getOrders(cashierActor, {
        businessId: 'biz-other',
        locationId: 'loc-other',
        orderType: OrderType.CATALOG,
        page: 1,
        limit: 10,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: {
          location: { businessId: 'biz-1' },
          locationId: 'loc-1',
          orderType: OrderType.CATALOG,
        },
      });
      expect(result.items).toHaveLength(1);
    });

    it('applies search, paymentMethod, status, and range filters for admin', async () => {
      orderCount.mockResolvedValue(1);
      orderFindMany.mockResolvedValue([{ id: 'order-1' }]);

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      await service.getOrders(adminActor, {
        locationId: 'loc-2',
        search: 'INV-1234',
        paymentMethod: PaymentMethod.COD,
        status: OrderStatus.PAID,
        range: 'today',
        page: 1,
        limit: 20,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          location: { businessId: 'biz-1' },
          locationId: 'loc-2',
          paymentMethod: PaymentMethod.COD,
          status: OrderStatus.PAID,
          occurredAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
          OR: expect.arrayContaining([
            { invoiceNumber: { contains: 'INV-1234', mode: 'insensitive' } },
            { receiptNumber: { contains: 'INV-1234', mode: 'insensitive' } },
            { customerName: { contains: 'INV-1234', mode: 'insensitive' } },
            { customerPhone: { contains: 'INV-1234', mode: 'insensitive' } },
            { customerNumber: { contains: 'INV-1234', mode: 'insensitive' } },
            {
              lines: {
                some: {
                  productName: { contains: 'INV-1234', mode: 'insensitive' },
                },
              },
            },
          ]),
        }),
      });
    });

    it('throws ForbiddenException when admin actor has no businessId', async () => {
      userFindFirst.mockResolvedValueOnce(null);
      const adminWithoutBiz = {
        sub: 'admin-nobiz',
        role: Role.ADMIN,
      };

      await expect(
        service.getOrders(adminWithoutBiz as any, { page: 1, limit: 10 }),
      ).rejects.toThrow(
        new ForbiddenException('Create a business before continuing'),
      );
    });

    it('filters to admin own orders when ownOrders is true or scope is my', async () => {
      orderCount.mockResolvedValue(1);
      orderFindMany.mockResolvedValue([{ id: 'order-admin-own' }]);

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      const result = await service.getOrders(adminActor, {
        ownOrders: true,
        page: 1,
        limit: 10,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          location: { businessId: 'biz-1' },
          cashierId: 'admin-1',
        }),
      });
      expect(result.items).toHaveLength(1);
    });

    it('filters orders by specific cashierId for admin', async () => {
      orderCount.mockResolvedValue(2);
      orderFindMany.mockResolvedValue([{ id: 'order-c1' }, { id: 'order-c2' }]);

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      await service.getOrders(adminActor, {
        cashierId: 'cashier-42',
        page: 1,
        limit: 10,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          location: { businessId: 'biz-1' },
          cashierId: 'cashier-42',
        }),
      });
    });

    it('filters orders by month name such as october', async () => {
      orderCount.mockResolvedValue(1);
      orderFindMany.mockResolvedValue([{ id: 'order-oct' }]);

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      await service.getOrders(adminActor, {
        month: 'october',
        year: 2026,
        page: 1,
        limit: 10,
      });

      expect(orderCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          location: { businessId: 'biz-1' },
          occurredAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      });
    });
  });

  describe('Legacy checkoutWithin support', () => {
    it('allows a legacy cashier checkout when no shift is open', async () => {
      shiftFindFirst.mockResolvedValue(null);
      variantFindFirst.mockResolvedValue({
        id: 'variant-1',
        name: 'Catalog item',
        stock: 10,
        sellingPrice: 500,
        costPrice: 300,
        isActive: true,
        product: {
          name: 'Catalog item',
          isActive: true,
          deletedAt: null,
          category: { name: 'General' },
        },
        locationStocks: [],
      });
      locationStockFindUnique.mockResolvedValue({ id: 'ls-1', stock: 10 });

      await service.checkoutWithin(
        tx as unknown as Prisma.TransactionClient,
        {
          sub: 'cashier-1',
          role: Role.CASHIER,
          businessId: 'biz-1',
          locationId: 'loc-1',
        },
        'biz-1',
        { items: [{ variantId: 'variant-1', quantity: 1 }] },
        'RCPT-TEST',
      );

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shiftId: null }),
        }),
      );
    });

    it('rejects legacy checkout when branch stock is insufficient', async () => {
      shiftFindFirst.mockResolvedValue(null);
      variantFindFirst.mockResolvedValue({
        id: 'variant-1',
        name: 'Catalog item',
        stock: 1,
        sellingPrice: 500,
        isActive: true,
        product: { name: 'Catalog item', isActive: true, deletedAt: null },
      });
      locationStockFindUnique.mockResolvedValue({ id: 'ls-1', stock: 1 });

      await expect(
        service.checkoutWithin(
          tx as unknown as Prisma.TransactionClient,
          {
            sub: 'cashier-1',
            role: Role.CASHIER,
            businessId: 'biz-1',
            locationId: 'loc-1',
          },
          'biz-1',
          { items: [{ variantId: 'variant-1', quantity: 2 }] },
          'RCPT-TEST',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Cross-tenant authorization in getOrders', () => {
    it('throws ForbiddenException when admin attempts to query orders of an unowned business', async () => {
      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1'],
      };

      await expect(
        service.getOrders(adminActor, { businessId: 'biz-foreign' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when cashier has no business or location assigned', async () => {
      const incompleteCashier = {
        sub: 'csh-no-loc',
        role: Role.CASHIER,
      };

      await expect(
        service.getOrders(incompleteCashier as never, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getOrderById', () => {
    it('returns order with authoritative per-line refunded and remaining refundable quantities', async () => {
      orderFindUnique.mockResolvedValue({
        id: 'order-101',
        invoiceNumber: 'INV-101',
        receiptNumber: 'RCPT-101',
        totalAmount: 1200,
        subtotal: 1200,
        status: OrderStatus.PAID,
        paymentMethod: PaymentMethod.COD,
        locationId: 'loc-1',
        location: { id: 'loc-1', businessId: 'biz-1', name: 'Main Branch' },
        lines: [
          {
            id: 'line-1',
            productName: 'Polo Shirt',
            variantName: 'Red / XL',
            unitPrice: 600,
            quantity: 2,
            subtotal: 1200,
            refundItems: [
              {
                id: 'rf-item-1',
                quantity: 1,
                refundAmount: 600,
                createdAt: new Date(),
              },
            ],
          },
        ],
      });

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1'],
      };

      const result = await service.getOrderById(adminActor, 'order-101');

      expect(result.id).toBe('order-101');
      expect(result.totalRefundedAmount).toBe(600);
      expect(result.lines[0].refundedQuantity).toBe(1);
      expect(result.lines[0].refundableQuantity).toBe(1);
      expect(result.lines[0].refundedAmount).toBe(600);
    });

    it('rejects cashier attempting to access an order from a different branch location', async () => {
      orderFindUnique.mockResolvedValue({
        id: 'order-202',
        locationId: 'loc-branch-2',
        location: { id: 'loc-branch-2', businessId: 'biz-1' },
        lines: [],
      });

      const cashierActor = {
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-branch-1',
      };

      await expect(
        service.getOrderById(cashierActor, 'order-202'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when order does not belong to any admin owned business', async () => {
      orderFindUnique.mockResolvedValue({
        id: 'order-303',
        locationId: 'loc-other',
        location: { id: 'loc-other', businessId: 'biz-other' },
        lines: [],
      });

      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1'],
      };

      await expect(
        service.getOrderById(adminActor, 'order-303'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
