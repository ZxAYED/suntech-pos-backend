import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { presentVariant, VariantService } from './variant.service';

describe('VariantService', () => {
  const productFindFirst = jest.fn();
  const variantFindFirst = jest.fn();
  const variantFindMany = jest.fn();
  const variantCreate = jest.fn();
  const variantUpdate = jest.fn();
  const variantUpdateMany = jest.fn();

  const prisma = {
    product: { findFirst: productFindFirst },
    variant: {
      findFirst: variantFindFirst,
      findMany: variantFindMany,
      create: variantCreate,
      update: variantUpdate,
      updateMany: variantUpdateMany,
    },
  } as unknown as PrismaService;

  const service = new VariantService(prisma);
  const admin = { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' };

  beforeEach(() => {
    productFindFirst.mockReset();
    variantFindFirst.mockReset();
    variantFindMany.mockReset();
    variantCreate.mockReset();
    variantUpdate.mockReset();
    variantUpdateMany.mockReset();

    productFindFirst.mockResolvedValue({ id: 'product-1' });
    variantFindFirst.mockResolvedValue(null);
  });

  describe('presentVariant helper', () => {
    it('enriches variant with top-level convenience fields and margin percent', () => {
      const row = {
        id: 'var-1',
        productId: 'prod-1',
        name: 'Midnight 256GB',
        sku: 'IPH-MID-256',
        barcode: '123456789012',
        sellingPrice: 10000,
        costPrice: 7000,
        stock: 12,
        profileImageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        images: [],
        product: {
          id: 'prod-1',
          name: 'iPhone 15',
          categoryId: 'cat-1',
          category: {
            id: 'cat-1',
            name: 'Smartphones',
          },
        },
      };

      const presented = presentVariant(row);

      expect(presented.productName).toBe('iPhone 15');
      expect(presented.categoryId).toBe('cat-1');
      expect(presented.categoryName).toBe('Smartphones');
      expect(presented.price).toBe(10000);
      expect(presented.marginPercent).toBe(30); // ((10000 - 7000) / 10000) * 100 = 30%
    });

    it('handles null costPrice or zero sellingPrice by setting marginPercent to null', () => {
      const rowNoCost = {
        sellingPrice: 5000,
        costPrice: null,
        product: null,
      };
      const rowZeroPrice = {
        sellingPrice: 0,
        costPrice: 100,
        product: null,
      };

      expect(
        presentVariant(
          rowNoCost as unknown as Parameters<typeof presentVariant>[0],
        ).marginPercent,
      ).toBeNull();
      expect(
        presentVariant(
          rowNoCost as unknown as Parameters<typeof presentVariant>[0],
        ).categoryName,
      ).toBe('Uncategorized');
      expect(
        presentVariant(
          rowZeroPrice as unknown as Parameters<typeof presentVariant>[0],
        ).marginPercent,
      ).toBeNull();
    });
  });

  describe('create', () => {
    it('mints a business sku when the admin omits one', async () => {
      variantCreate.mockImplementation(
        ({ data }: { data: { sku: string; businessId: string } }) =>
          Promise.resolve({
            ...data,
            id: 'var-new',
            sellingPrice: 1500,
            costPrice: null,
            stock: 0,
            product: {
              id: 'product-1',
              name: 'Product',
              categoryId: null,
              category: null,
            },
          }),
      );

      const created = await service.create(admin, {
        productId: 'product-1',
        name: 'Red',
        sellingPrice: 1500,
      });

      expect(created.businessId).toBe('biz-1');
      expect(created.sku).toMatch(/^PRD-[A-Z2-9]{6}$/);
      expect(created.productName).toBe('Product');
      expect(created.categoryName).toBe('Uncategorized');
    });

    it('returns 409 when a supplied sku collides', async () => {
      variantCreate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.create(admin, {
          productId: 'product-1',
          name: 'Red',
          sku: 'TEE-1',
          sellingPrice: 1500,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('list', () => {
    it('queries variants with categoryId, productId, search, and lowStockOnly filters', async () => {
      variantFindMany.mockResolvedValue([
        {
          id: 'var-1',
          productId: 'prod-1',
          name: '128GB Silver',
          sku: 'IPH-SLV-128',
          barcode: '99887766',
          sellingPrice: 80000,
          costPrice: 60000,
          stock: 3,
          product: {
            id: 'prod-1',
            name: 'iPhone 14',
            categoryId: 'cat-phones',
            category: { id: 'cat-phones', name: 'Phones' },
          },
        },
      ]);

      const res = await service.list(admin, {
        categoryId: 'cat-phones',
        productId: 'prod-1',
        search: 'Silver',
        lowStockOnly: 'true',
      });

      const findCall = (
        variantFindMany.mock.calls as unknown as Array<
          [{ where: Record<string, unknown>; orderBy: Record<string, string> }]
        >
      )[0][0];
      expect(findCall.where).toEqual({
        businessId: 'biz-1',
        deletedAt: null,
        product: {
          businessId: 'biz-1',
          deletedAt: null,
          categoryId: 'cat-phones',
        },
        productId: 'prod-1',
        stock: { lte: 5 },
        OR: [
          { name: { contains: 'Silver', mode: 'insensitive' } },
          { sku: { contains: 'Silver', mode: 'insensitive' } },
          { barcode: { contains: 'Silver', mode: 'insensitive' } },
          { product: { name: { contains: 'Silver', mode: 'insensitive' } } },
        ],
      });
      expect(findCall.orderBy).toEqual({ name: 'asc' });

      expect(res).toHaveLength(1);
      expect(res[0].productName).toBe('iPhone 14');
      expect(res[0].categoryName).toBe('Phones');
      expect(res[0].price).toBe(80000);
      expect(res[0].marginPercent).toBe(25);
    });
  });

  describe('remove', () => {
    it('soft-deletes variant with __del_ suffix on sku and barcode', async () => {
      variantFindFirst.mockResolvedValue({
        id: 'var-1',
        sku: 'SKU-100',
        barcode: 'BAR-100',
      });

      const res = await service.remove(admin, 'var-1');

      expect(res.id).toBe('var-1');
      expect(res.deletedAt).toBeInstanceOf(Date);
      const updateCall = (
        variantUpdate.mock.calls as unknown as Array<
          [
            {
              where: { id: string };
              data: { sku: string; barcode: string | null; deletedAt: Date };
            },
          ]
        >
      )[0][0];
      expect(updateCall.where.id).toBe('var-1');
      expect(updateCall.data.sku).toMatch(/^SKU-100__del_\d+$/);
      expect(updateCall.data.barcode).toMatch(/^BAR-100__del_\d+$/);
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('soft-deletes variant with null barcode cleanly without suffixing barcode', async () => {
      variantFindFirst.mockResolvedValue({
        id: 'var-2',
        sku: 'SKU-200',
        barcode: null,
      });

      await service.remove(admin, 'var-2');

      const updateCall = (
        variantUpdate.mock.calls as unknown as Array<
          [
            {
              where: { id: string };
              data: { sku: string; barcode: string | null; deletedAt: Date };
            },
          ]
        >
      )[0][0];
      expect(updateCall.where.id).toBe('var-2');
      expect(updateCall.data.sku).toMatch(/^SKU-200__del_\d+$/);
      expect(updateCall.data.barcode).toBeNull();
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when removing a non-existent variant', async () => {
      variantFindFirst.mockResolvedValue(null);

      await expect(service.remove(admin, 'var-none')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('filters variants by businessId query for Admin', async () => {
      variantFindMany.mockResolvedValue([]);

      await service.list(admin, { businessId: 'biz-target' });

      const findCall = (
        variantFindMany.mock.calls as unknown as Array<
          [{ where: Record<string, unknown> }]
        >
      )[0][0];
      expect(findCall.where.businessId).toBe('biz-target');
    });

    it('scopes Cashier variant listing to token businessId and branch stock', async () => {
      const cashier = {
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-cashier',
        locationId: 'loc-branch-1',
      };

      variantFindMany.mockResolvedValue([
        {
          id: 'var-1',
          productId: 'prod-1',
          name: 'Variant 1',
          sku: 'SKU-1',
          barcode: 'BAR-1',
          sellingPrice: 100,
          costPrice: 60,
          stock: 50,
          profileImageUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          images: [],
          product: { id: 'prod-1', name: 'Product', categoryId: null, category: null },
          locationStocks: [
            { locationId: 'loc-branch-1', stock: 12 },
            { locationId: 'loc-branch-2', stock: 38 },
          ],
        },
      ]);

      const res = await service.list(cashier, { businessId: 'biz-fake' });

      const findCall = (
        variantFindMany.mock.calls as unknown as Array<
          [{ where: Record<string, unknown> }]
        >
      )[0][0];
      expect(findCall.where.businessId).toBe('biz-cashier');
      expect(res[0].stock).toBe(12);
    });
  });
});
