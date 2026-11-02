import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditReadService } from './audit-read.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload } from '../types/access-token-payload';

describe('AuditReadService', () => {
  let service: AuditReadService;
  let prisma: any;

  const mockAdmin: AccessTokenPayload = {
    sub: 'admin-user-id',
    role: Role.ADMIN,
    businessId: 'biz-1',
  };

  const mockCashier: AccessTokenPayload = {
    sub: 'cashier-user-id',
    role: Role.CASHIER,
    businessId: 'biz-1',
  };

  beforeEach(() => {
    prisma = {
      business: {
        findFirst: jest.fn(),
      },
      location: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      auditLog: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      variant: {
        findMany: jest.fn(),
      },
      product: {
        findMany: jest.fn(),
      },
      category: {
        findMany: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
      },
      expense: {
        findMany: jest.fn(),
      },
    };

    service = new AuditReadService(prisma as unknown as PrismaService);
  });

  describe('Authorization checks', () => {
    it('throws ForbiddenException if actor is not ADMIN', async () => {
      await expect(
        service.list(mockCashier, { businessId: 'biz-1', page: 1, limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if businessId is missing', async () => {
      await expect(
        service.list(mockAdmin, { page: 1, limit: 20 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException if business is not owned by admin', async () => {
      prisma.business.findFirst.mockResolvedValue(null);

      await expect(
        service.list(mockAdmin, { businessId: 'biz-unauthorized', page: 1, limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('list & enrichment', () => {
    it('populates actor name, location name, variant info, clean metadata, issue, and summary', async () => {
      prisma.business.findFirst.mockResolvedValue({ id: 'biz-1' });

      const rawLogs = [
        {
          id: 'log-1',
          actorId: 'user-cashier-1',
          businessId: 'biz-1',
          locationId: 'loc-dhanmondi-1',
          action: 'LOW_STOCK_AFTER_SALE',
          entityType: 'VARIANT',
          entityId: 'var-iphone15-black',
          metadata: {
            orderId: 'order-123',
            deviceId: null,
            variantId: 'var-iphone15-black',
            locationId: 'loc-dhanmondi-1',
            quantitySold: 3,
            invoiceNumber: 'INV-20261031-VWF8',
            previousStock: 7,
            resultingStock: 4,
          },
          ipAddress: null,
          createdAt: new Date('2026-10-31T11:14:21.917Z'),
        },
      ];

      prisma.auditLog.findMany.mockResolvedValue(rawLogs);
      prisma.auditLog.count.mockResolvedValue(1);

      prisma.user.findMany.mockResolvedValue([
        { id: 'user-cashier-1', fullName: 'Jane Cashier', role: 'CASHIER' },
      ]);
      prisma.location.findMany.mockResolvedValue([
        { id: 'loc-dhanmondi-1', name: 'Dhanmondi Branch' },
      ]);
      prisma.variant.findMany.mockResolvedValue([
        {
          id: 'var-iphone15-black',
          name: '128GB Black',
          sku: 'IPH15-BLK-128',
          product: { id: 'prod-iphone15', name: 'iPhone 15' },
        },
      ]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.category.findMany.mockResolvedValue([]);
      prisma.order.findMany.mockResolvedValue([
        { id: 'order-123', invoiceNumber: 'INV-20261031-VWF8' },
      ]);
      prisma.expense.findMany.mockResolvedValue([]);

      const result = await service.list(mockAdmin, {
        businessId: 'biz-1',
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      const item = result.items[0];

      // Actor populated
      expect(item.actorName).toBe('Jane Cashier');
      expect(item.actorRole).toBe('CASHIER');
      expect(item.actor).toEqual({
        id: 'user-cashier-1',
        name: 'Jane Cashier',
        role: 'CASHIER',
      });

      // Location populated
      expect(item.locationName).toBe('Dhanmondi Branch');
      expect(item.location).toEqual({
        id: 'loc-dhanmondi-1',
        name: 'Dhanmondi Branch',
      });

      // Entity populated with product & variant name
      expect(item.entityName).toBe('iPhone 15 (128GB Black)');
      expect(item.sku).toBe('IPH15-BLK-128');
      expect(item.entity).toEqual({
        type: 'VARIANT',
        id: 'var-iphone15-black',
        name: 'iPhone 15 (128GB Black)',
        sku: 'IPH15-BLK-128',
        productName: 'iPhone 15',
        variantName: '128GB Black',
      });

      // Issue and summary
      expect(item.issue).toBe('Low Stock Alert');
      expect(item.summary).toContain('iPhone 15 (128GB Black) reached 4 unit(s) remaining');
      expect(item.summary).toContain('INV-20261031-VWF8');

      // Cleaned metadata: noisy UUIDs and deviceId: null removed
      expect(item.metadata).toEqual({
        quantitySold: 3,
        invoiceNumber: 'INV-20261031-VWF8',
        previousStock: 7,
        resultingStock: 4,
      });
      expect(item.metadata).not.toHaveProperty('orderId');
      expect(item.metadata).not.toHaveProperty('variantId');
      expect(item.metadata).not.toHaveProperty('locationId');
      expect(item.metadata).not.toHaveProperty('deviceId');
    });

    it('formats BRANCH_REASSIGNMENT with previous and new location names', async () => {
      prisma.business.findFirst.mockResolvedValue({ id: 'biz-1' });

      const rawLogs = [
        {
          id: 'log-2',
          actorId: 'admin-user-id',
          businessId: 'biz-1',
          locationId: null,
          action: 'BRANCH_REASSIGNMENT',
          entityType: 'USER',
          entityId: 'user-cashier-1',
          metadata: {
            previousLocationId: 'loc-1',
            newLocationId: 'loc-2',
          },
          ipAddress: null,
          createdAt: new Date(),
        },
      ];

      prisma.auditLog.findMany.mockResolvedValue(rawLogs);
      prisma.auditLog.count.mockResolvedValue(1);

      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-user-id', fullName: 'Super Admin', role: 'ADMIN' },
        { id: 'user-cashier-1', fullName: 'Jane Cashier', role: 'CASHIER' },
      ]);
      prisma.location.findMany.mockResolvedValue([
        { id: 'loc-1', name: 'Banani Branch' },
        { id: 'loc-2', name: 'Uttara Branch' },
      ]);
      prisma.variant.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.category.findMany.mockResolvedValue([]);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.expense.findMany.mockResolvedValue([]);

      const result = await service.list(mockAdmin, {
        businessId: 'biz-1',
        page: 1,
        limit: 20,
      });

      const item = result.items[0];
      expect(item.issue).toBe('Branch Reassigned');
      expect(item.entityName).toBe('Jane Cashier (CASHIER)');
      expect(item.summary).toContain('reassigned from "Banani Branch" to "Uttara Branch"');
      expect(item.metadata).toEqual({
        previousLocation: 'Banani Branch',
        newLocation: 'Uttara Branch',
      });
    });
  });

  describe('get', () => {
    it('returns enriched audit log for single item', async () => {
      prisma.business.findFirst.mockResolvedValue({ id: 'biz-1' });
      prisma.auditLog.findFirst.mockResolvedValue({
        id: 'log-1',
        actorId: 'user-admin',
        businessId: 'biz-1',
        locationId: null,
        action: 'ADMIN_PASSWORD_RESET',
        entityType: 'USER',
        entityId: 'user-cashier',
        metadata: null,
        ipAddress: null,
        createdAt: new Date(),
      });

      prisma.user.findMany.mockResolvedValue([
        { id: 'user-admin', fullName: 'Main Admin', role: 'ADMIN' },
        { id: 'user-cashier', fullName: 'John Doe', role: 'CASHIER' },
      ]);
      prisma.location.findMany.mockResolvedValue([]);
      prisma.variant.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.category.findMany.mockResolvedValue([]);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.expense.findMany.mockResolvedValue([]);

      const result = await service.get(mockAdmin, 'log-1', 'biz-1');
      expect(result.actorName).toBe('Main Admin');
      expect(result.entityName).toBe('John Doe (CASHIER)');
      expect(result.issue).toBe('Password Reset');
      expect(result.summary).toContain('Password for John Doe (CASHIER) was reset by Main Admin');
    });

    it('throws NotFoundException if log does not exist', async () => {
      prisma.business.findFirst.mockResolvedValue({ id: 'biz-1' });
      prisma.auditLog.findFirst.mockResolvedValue(null);

      await expect(service.get(mockAdmin, 'non-existent', 'biz-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
