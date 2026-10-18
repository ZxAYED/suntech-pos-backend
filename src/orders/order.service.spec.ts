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
    order: { create: orderCreate, count: orderCount, findMany: orderFindMany },
  };

  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
    order: { count: orderCount, findMany: orderFindMany },
  };

  const service = new OrdersService(prisma as never);

  const cashierUser = {
    id: 'user-cashier-1',
    role: Role.CASHIER,
    businessId: 'biz-1',
    deletedAt: null,
  };

  const adminUser = {
    id: 'user-admin-1',
    role: Role.ADMIN,
    businessId: 'biz-1',
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
    cashierId: 'user-cashier-1',
    status: ShiftStatus.OPEN,
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
    orderCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'order-1', ...data }),
    );
  });

  describe('createCatalogOrder (Flow 1)', () => {
    it('successfully processes a catalog order with stock decrement and shift increment', async () => {
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

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
        include: { product: { select: { name: true } } },
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
                  quantity: 2,
                  unitPrice: 1500,
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
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

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

    it('rejects immediately with BadRequestException when stock is insufficient', async () => {
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 1, // Insufficient for quantity 2
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 3000,
          lines: [{ variantId: 'variant-1', quantity: 2, unitPrice: 1500 }],
        }),
      ).rejects.toThrow(
        new BadRequestException('Insufficient stock for variant variant-1'),
      );

      expect(variantUpdate).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
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
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1000, // Less than 1500
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cashier without an open shift', async () => {
      shiftFindFirst.mockResolvedValue(null);

      await expect(
        service.createCatalogOrder('user-cashier-1', {
          locationId: 'loc-1',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows Admin to sell without shiftId', async () => {
      userFindFirst.mockResolvedValue(adminUser);
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

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

    it('throws ForbiddenException if cashier attempts to create order for an unassigned location', async () => {
      const cashierActor = {
        sub: 'user-cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-1',
      };

      await expect(
        service.createCatalogOrder(cashierActor, {
          locationId: 'loc-other',
          tenderedAmount: 1500,
          lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 1500 }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not increment physical cash drawer when paymentMethod is digital (BKASH)', async () => {
      variantFindMany.mockResolvedValue([
        {
          id: 'variant-1',
          name: '128GB Black',
          stock: 10,
          sellingPrice: 1500,
          product: { name: 'iPhone 15' },
        },
      ]);

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
                  quantity: 2,
                  unitPrice: 250,
                  subtotal: 500,
                },
                {
                  variantId: null,
                  productName: 'Quick Back Cover Installation',
                  variantName: null,
                  quantity: 1,
                  unitPrice: 500,
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
        orderBy: { createdAt: 'desc' },
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
          createdAt: expect.objectContaining({
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
  });

  describe('Legacy checkoutWithin support', () => {
    it('refuses a cashier checkout when no shift is open', async () => {
      shiftFindFirst.mockResolvedValue(null);

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
          { items: [{ variantId: 'variant-1', quantity: 1 }] },
          'RCPT-TEST',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
