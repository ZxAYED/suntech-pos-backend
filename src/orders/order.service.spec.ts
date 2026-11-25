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
import { computeSyncPayloadHash } from './sync-payload-hash';
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
  const auditFindFirst = jest.fn();
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
    auditLog: { create: auditCreate, findFirst: auditFindFirst },
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
    auditLog: { create: auditCreate, findFirst: auditFindFirst },
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
        paymentMethod: PaymentMethod.COD,
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

    it('allows online catalog order when branch has no existing location stock (upserts negative balance)', async () => {
      variantFindMany.mockResolvedValueOnce([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 0,
          sellingPrice: 1500,
          isActive: true,
          product: {
            id: 'prod-1',
            name: 'iPhone 15',
            isActive: true,
            deletedAt: null,
          },
          locationStocks: [], // No stock record for this branch
        },
      ]);
      locationStockUpsert.mockResolvedValueOnce({ id: 'ls-new', stock: -2 });

      const result = await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 3000,
        lines: [{ variantId: 'variant-1', quantity: 2, unitPrice: 1500 }],
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('PAID');
      expect(locationStockUpsert).toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalled();
    });

    it('allows online catalog order when stock is insufficient and allows negative stock (MVP Policy)', async () => {
      locationStockUpdate.mockResolvedValueOnce({ stock: -1 });

      const result = await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 3000,
        lines: [{ variantId: 'variant-1', quantity: 2, unitPrice: 1500 }],
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('PAID');
      expect(locationStockUpdate).toHaveBeenCalled();
      expect(variantUpdate).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { stock: { decrement: 2 } },
      });
      expect(orderCreate).toHaveBeenCalled();
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
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shiftId: null }),
        }),
      );
    });

    it('keeps shiftId: null and does not increment shift cash when shiftId is explicitly null', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: null,
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shiftId: null,
          }),
        }),
      );
    });

    it('does not auto-attach an unclosed shift from a previous day when shiftId is omitted', async () => {
      shiftFindFirst.mockResolvedValue(null);
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-cashier-1', {
        locationId: 'loc-1',
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 1500,
        lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
      });

      expect(shiftFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            openedAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        }),
      );
      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shiftId: null,
          }),
        }),
      );
    });

    it('allows Admin to sell without shiftId', async () => {
      userFindFirst.mockResolvedValue(adminUser);
      shiftFindFirst.mockResolvedValue(null);
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await service.createCatalogOrder('user-admin-1', {
        businessId: 'biz-1',
        locationId: 'loc-1',
        paymentMethod: PaymentMethod.COD,
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

    it('rejects Admin checkout with HTTP 400 when businessId is missing', async () => {
      userFindFirst.mockResolvedValue(adminUser);

      await expect(
        service.createCatalogOrder('user-admin-1', {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(new BadRequestException('businessId is required for Admin checkout'));
    });

    it('rejects Admin checkout with HTTP 400 when locationId is missing', async () => {
      userFindFirst.mockResolvedValue(adminUser);

      await expect(
        service.createCatalogOrder('user-admin-1', {
          businessId: 'biz-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(new BadRequestException('locationId is required for Admin checkout'));
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
        paymentMethod: PaymentMethod.COD,
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

    it('throws BadRequestException when paymentMethod is omitted on checkout (no default COD)', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when paymentMethod and paymentType conflict', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          paymentMethod: PaymentMethod.COD,
          paymentType: PaymentMethod.BKASH,
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException with PRICE_CHANGED when submitted unitPrice differs from DB sellingPrice', async () => {
      variantFindMany.mockResolvedValue([mockCatalogVariant]); // sellingPrice is 1500

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          paymentMethod: PaymentMethod.COD,
          tenderedAmount: 1200,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1200 }], // Cart has stale price 1200
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PRICE_CHANGED',
          currentPrice: 1500,
          submittedPrice: 1200,
        }),
      });
    });
  });

  describe('createCustomOrder (Flow 2)', () => {
    it('bypasses catalog lookup and stock decrement while creating custom order', async () => {
      const result = await service.createCustomOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: 'shift-1',
        paymentMethod: PaymentMethod.COD,
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

    it('keeps shiftId: null and does not increment shift cash when shiftId is explicitly null', async () => {
      await service.createCustomOrder('user-cashier-1', {
        locationId: 'loc-1',
        shiftId: null,
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 500,
        lines: [
          {
            productName: 'Custom repair',
            quantity: 1,
            unitPrice: 500,
          },
        ],
      });

      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shiftId: null,
          }),
        }),
      );
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
      const secondItemHash = computeSyncPayloadHash({
        clientOrderId: '22222222-2222-4222-8222-222222222222',
        deviceId: 'counter-01',
        businessId: 'biz-1',
        locationId: 'loc-1',
        cashierId: 'user-cashier-1',
        occurredAt: '2026-10-24T13:31:00+06:00',
        orderType: OrderType.CUSTOM,
        paymentMethod: PaymentMethod.COD,
        tenderedAmount: 200,
        shiftId: null,
        lines: [{ productName: 'Cable', quantity: 1, unitPrice: 200 }],
      });
      orderFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'order-existing',
        invoiceNumber: 'INV-OLD',
        syncPayloadHash: secondItemHash,
        occurredAt: new Date('2026-10-24T13:31:00+06:00'),
        createdAt: new Date('2026-10-24T13:35:00+06:00'),
        location: { businessId: 'biz-1' },
        cashierId: 'user-cashier-1',
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
        syncPayloadHash: 'v1:original-hash-differs',
        location: { businessId: 'biz-1' },
        cashierId: 'user-cashier-1',
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

    it('keeps shiftId: null and suppresses SHIFT_NOT_ATTACHED warning when shiftId is explicitly null', async () => {
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '66666666-6666-4666-8666-666666666666',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            shiftId: null,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('ACCEPTED');
      expect(result.results[0].warnings).toEqual([]);
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shiftId: null,
          }),
        }),
      );
    });

    it('rejects order with TIMESTAMP_TIMEZONE_REQUIRED when occurredAt lacks timezone offset', async () => {
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '11111111-2222-4333-8444-555555555555',
            occurredAt: '2026-10-24T13:30:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].errorCode).toBe('TIMESTAMP_TIMEZONE_REQUIRED');
      expect(result.serverTime).toBeDefined();
    });

    it('rejects order with TIMESTAMP_INVALID when occurredAt is an impossible calendar date', async () => {
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '11111111-2222-4333-8444-555555555555',
            occurredAt: '2026-02-30T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].errorCode).toBe('TIMESTAMP_INVALID');
    });

    it('accepts future timestamp within 300s skew with CLOCK_SKEW_TOLERATED warning', async () => {
      const nearFuture = new Date(Date.now() + 60 * 1000).toISOString();
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '22222222-3333-4444-8555-666666666666',
            occurredAt: nearFuture,
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            shiftId: null,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('ACCEPTED');
      expect(result.results[0].warnings).toContain('CLOCK_SKEW_TOLERATED');
    });

    it('rejects future timestamp beyond skew with TIMESTAMP_FUTURE_REVIEW_REQUIRED', async () => {
      const farFuture = new Date(Date.now() + 3600 * 1000).toISOString();
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '33333333-4444-4555-8666-777777777777',
            occurredAt: farFuture,
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].errorCode).toBe('TIMESTAMP_FUTURE_REVIEW_REQUIRED');
    });

    it('accepts valid 10-day-old offline order without past-age rejection', async () => {
      const past10Days = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '44444444-5555-4666-8777-888888888888',
            occurredAt: past10Days,
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            shiftId: null,
            lines: [{ productName: 'Old offline sale', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('ACCEPTED');
      expect(result.results[0].warnings).not.toContain('CLOCK_SKEW_TOLERATED');
    });

    it('rejects clientOrderId replay when tenant or cashier context differs', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-diff-tenant',
        invoiceNumber: 'INV-DIFF',
        syncPayloadHash: 'v1:any-hash',
        location: { businessId: 'different-biz' },
        cashierId: 'user-cashier-1',
      });

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '55555555-6666-4777-8888-999999999999',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Item', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].errorCode).toBe('SYNC_IDENTITY_CONFLICT');
    });

    it('rejects replay of legacy unhashed order when not admin confirmed', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-legacy-1',
        invoiceNumber: 'INV-LEGACY',
        syncPayloadHash: null,
        location: { businessId: 'biz-1' },
        cashierId: 'user-cashier-1',
      });
      auditFindFirst.mockResolvedValueOnce(null);

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '66666666-7777-4888-8999-000000000000',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Legacy Item', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('REJECTED');
      expect(result.results[0].errorCode).toBe('LEGACY_SYNC_REPLAY_REVIEW_REQUIRED');
    });

    it('accepts replay of legacy unhashed order as DUPLICATE when admin confirmed', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-legacy-2',
        invoiceNumber: 'INV-LEGACY-2',
        syncPayloadHash: null,
        occurredAt: new Date('2026-10-24T13:30:00+06:00'),
        createdAt: new Date('2026-10-24T13:35:00+06:00'),
        location: { businessId: 'biz-1' },
        cashierId: 'user-cashier-1',
      });
      auditFindFirst.mockResolvedValueOnce({ id: 'audit-legacy-confirmed' });

      const result = await service.syncOrders(actor, {
        deviceId: 'counter-01',
        orders: [
          {
            clientOrderId: '77777777-8888-4999-8000-111111111111',
            occurredAt: '2026-10-24T13:30:00+06:00',
            orderType: OrderType.CUSTOM,
            tenderedAmount: 500,
            lines: [{ productName: 'Legacy Item', quantity: 1, unitPrice: 500 }],
          },
        ],
      });

      expect(result.results[0].status).toBe('DUPLICATE');
      expect(result.results[0].orderId).toBe('order-legacy-2');
      expect(result.results[0].warnings).toContain('LEGACY_REPLAY_ADMIN_CONFIRMED');
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
            lt: expect.any(Date),
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
            lt: expect.any(Date),
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

    it('allows legacy checkout when branch stock is insufficient (negative stock)', async () => {
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
      locationStockUpdate.mockResolvedValue({ id: 'ls-1', stock: -1 });

      const result = await service.checkoutWithin(
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
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('PAID');
    });

    it('keeps shiftId: null when shiftId is explicitly null in legacy checkout', async () => {
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
        {
          shiftId: null,
          items: [{ variantId: 'variant-1', quantity: 1 }],
        },
        'RCPT-TEST-NULL',
      );

      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shiftId: null }),
        }),
      );
    });

    it('throws BadRequestException when an invalid or closed shiftId is provided to legacy checkout', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-closed',
        businessId: 'biz-1',
        status: ShiftStatus.CLOSED,
        locationId: 'loc-1',
        cashierId: 'cashier-1',
      });

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
          {
            shiftId: 'shift-closed',
            items: [{ variantId: 'variant-1', quantity: 1 }],
          },
          'RCPT-TEST-INVALID',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Provided shiftId is invalid, closed, or not accessible',
        ),
      );
    });

    it('does not attach an older prior-day open shift when shiftId is omitted in legacy checkout', async () => {
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
        {
          items: [{ variantId: 'variant-1', quantity: 1 }],
        },
        'RCPT-TEST-NO-TODAY-SHIFT',
      );

      expect(shiftFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            openedAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        }),
      );
      expect(shiftUpdate).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shiftId: null }),
        }),
      );
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

    it('throws BadRequestException when Admin checks out without businessId', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }],
      });
      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      await expect(
        service.createCatalogOrder(adminActor as any, {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        } as any),
      ).rejects.toThrow('businessId is required for Admin checkout');
    });

    it('throws BadRequestException when Admin checks out without locationId', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }],
      });
      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      };

      await expect(
        service.createCatalogOrder(adminActor as any, {
          businessId: 'biz-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        } as any),
      ).rejects.toThrow('locationId is required for Admin checkout');
    });

    it('throws BadRequestException when Admin checks out with mismatched business and location', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }, { id: 'biz-2' }],
      });
      locationFindFirst.mockImplementation(({ where }: { where: { businessId?: string } }) => {
        if (where.businessId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: 'loc-2', businessId: 'biz-2' });
      });
      const adminActor = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1', 'biz-2'],
      };

      await expect(
        service.createCatalogOrder(adminActor as any, {
          businessId: 'biz-1',
          locationId: 'loc-2',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        } as any),
      ).rejects.toThrow('Location does not belong to the specified business');
    });
  });

  describe('confirmLegacySync', () => {
    const adminActor = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
      businessIds: ['biz-1'],
    };

    const validOrderDto = {
      clientOrderId: 'some-client-order-id',
      occurredAt: '2026-10-24T13:30:00+06:00',
      orderType: OrderType.CUSTOM,
      paymentMethod: PaymentMethod.COD,
      tenderedAmount: 500,
      lines: [{ productName: 'Item', quantity: 1, unitPrice: 500 }],
    };

    it('successfully confirms legacy unhashed order', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-legacy-confirm',
        clientOrderId: 'some-client-order-id',
        invoiceNumber: 'INV-LEGACY-CONFIRM',
        syncPayloadHash: null,
        totalAmount: 500,
        paymentMethod: PaymentMethod.COD,
        occurredAt: new Date('2026-10-24T13:30:00+06:00'),
        createdAt: new Date('2026-10-24T13:35:00+06:00'),
        lines: [{ quantity: 1, unitPrice: 500 }],
        location: { businessId: 'biz-1' },
      });
      auditCreate.mockResolvedValueOnce({ id: 'audit-legacy-1' });
      auditFindFirst.mockResolvedValueOnce(null);
      userFindFirst.mockResolvedValueOnce({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }],
      });

      const res = await service.confirmLegacySync(
        adminActor,
        'order-legacy-confirm',
        {
          deviceId: 'counter-01',
          reason: 'Verified with physical paper receipt',
          order: validOrderDto,
        },
      );

      expect(res.orderId).toBe('order-legacy-confirm');
      expect(res.status).toBe('DUPLICATE');
      expect(res.warnings).toContain('LEGACY_REPLAY_ADMIN_CONFIRMED');
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'LEGACY_SYNC_REPLAY_CONFIRMED',
          }),
        }),
      );
    });

    it('rejects confirmation if order already has syncPayloadHash', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-already-hashed',
        clientOrderId: 'some-client-order-id',
        syncPayloadHash: 'v1:already-hashed',
        totalAmount: 500,
        paymentMethod: PaymentMethod.COD,
        lines: [{ quantity: 1, unitPrice: 500 }],
        location: { businessId: 'biz-1' },
      });
      userFindFirst.mockResolvedValueOnce({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }],
      });

      await expect(
        service.confirmLegacySync(adminActor, 'order-already-hashed', {
          deviceId: 'counter-01',
          reason: 'Any reason',
          order: validOrderDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects confirmation if reason is blank', async () => {
      await expect(
        service.confirmLegacySync(adminActor, 'order-legacy-unhashed', {
          deviceId: 'counter-01',
          reason: '   ',
          order: validOrderDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ForbiddenException when admin does not own the business', async () => {
      orderFindUnique.mockResolvedValueOnce({
        id: 'order-other-biz',
        clientOrderId: 'some-client-order-id',
        syncPayloadHash: null,
        totalAmount: 500,
        paymentMethod: PaymentMethod.COD,
        lines: [{ quantity: 1, unitPrice: 500 }],
        location: { businessId: 'other-biz' },
      });
      userFindFirst.mockResolvedValueOnce({
        id: 'admin-1',
        role: Role.ADMIN,
        ownedBusinesses: [{ id: 'biz-1' }],
      });

      await expect(
        service.confirmLegacySync(adminActor, 'order-other-biz', {
          deviceId: 'counter-01',
          reason: 'Valid rationale',
          order: validOrderDto,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
