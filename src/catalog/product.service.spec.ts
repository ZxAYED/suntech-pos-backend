import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from './product.service';

describe('ProductService', () => {
  const productFindFirst = jest.fn();
  const productFindMany = jest.fn();
  const productCreate = jest.fn();
  const productUpdate = jest.fn();
  const productUpdateMany = jest.fn();
  const categoryFindFirst = jest.fn();

  const prisma = {
    product: {
      findFirst: productFindFirst,
      findMany: productFindMany,
      create: productCreate,
      update: productUpdate,
      updateMany: productUpdateMany,
    },
    category: {
      findFirst: categoryFindFirst,
    },
  } as unknown as PrismaService;

  const service = new ProductService(prisma);
  const admin = {
    sub: 'admin-1',
    role: Role.ADMIN,
    businessId: 'biz-1',
  };

  beforeEach(() => {
    productFindFirst.mockReset();
    productFindMany.mockReset();
    productCreate.mockReset();
    productUpdate.mockReset();
    productUpdateMany.mockReset();
    categoryFindFirst.mockReset();

    productFindFirst.mockResolvedValue(null);
    categoryFindFirst.mockResolvedValue({ id: 'cat-1' });
    productCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'prod-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          category: { id: 'cat-1', name: 'Electronics', deletedAt: null },
          variants: [],
          ...data,
        }),
    );
    productUpdate.mockResolvedValue({ id: 'prod-1' });
    productUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('creates a product when name is available', async () => {
    const res = await service.create(admin, {
      name: 'iPhone 15 Pro',
      description: 'Flagship phone',
      categoryId: 'cat-1',
    });

    const call = (
      productCreate.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0];
    expect(call.data).toEqual({
      businessId: 'biz-1',
      name: 'iPhone 15 Pro',
      description: 'Flagship phone',
      categoryId: 'cat-1',
      customAttributes: Prisma.DbNull,
    });
    expect(res.name).toBe('iPhone 15 Pro');
    expect(res.category).toEqual({ id: 'cat-1', name: 'Electronics' });
  });

  it('creates a product with multiple custom attributes (e.g. IMEI, serial number)', async () => {
    const res = await service.create(admin, {
      name: 'iPhone 15 Pro Max',
      customAttributes: [
        { key: 'IMEI', value: '358249012345678' },
        { key: 'Serial Number', value: 'SN-APPLE-123' },
        { key: 'Warranty', value: '1 Year AppleCare' },
      ],
    });

    const call = (
      productCreate.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0];
    expect(call.data.customAttributes).toEqual([
      { key: 'IMEI', value: '358249012345678' },
      { key: 'Serial Number', value: 'SN-APPLE-123' },
      { key: 'Warranty', value: '1 Year AppleCare' },
    ]);
    expect(res.name).toBe('iPhone 15 Pro Max');
  });

  it('normalizes key-value dictionary and attachments alias for custom attributes', async () => {
    await service.create(admin, {
      name: 'Samsung Galaxy S24',
      attachments: {
        IMEI: '359111222333444',
        Color: 'Titanium Gray',
      },
    });

    const call = (
      productCreate.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0];
    expect(call.data.customAttributes).toEqual([
      { key: 'IMEI', value: '359111222333444' },
      { key: 'Color', value: 'Titanium Gray' },
    ]);
  });

  it('updates product custom attributes via update method', async () => {
    productFindFirst.mockResolvedValueOnce({
      id: 'prod-1',
      businessId: 'biz-1',
      name: 'Existing Product',
    });
    productFindFirst.mockResolvedValueOnce({
      id: 'prod-1',
      businessId: 'biz-1',
      name: 'Existing Product',
      customAttributes: [{ key: 'IMEI', value: 'updated-imei' }],
      category: null,
      variants: [],
    });

    await service.update(admin, 'prod-1', {
      customAttributes: [{ key: 'IMEI', value: 'updated-imei' }],
    });

    const updateCall = (
      productUpdateMany.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0];
    expect(updateCall.data.customAttributes).toEqual([
      { key: 'IMEI', value: 'updated-imei' },
    ]);
  });

  it('rejects product creation when name collides', async () => {
    productFindFirst.mockResolvedValue({ id: 'prod-existing' });

    await expect(
      service.create(admin, { name: 'iPhone 15 Pro' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists products with categoryId and search filter matching name, description, and variant codes', async () => {
    productFindMany.mockResolvedValue([
      {
        id: 'prod-1',
        name: 'iPhone 15 Pro',
        description: 'Flagship phone',
        categoryId: 'cat-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        category: { id: 'cat-1', name: 'Phones', deletedAt: null },
        variants: [
          {
            id: 'var-1',
            name: 'Black Titanium 128GB',
            sku: 'IPH-15P-BLK',
            barcode: '123456789',
            sellingPrice: 120000,
            costPrice: 100000,
            stock: 10,
            profileImageUrl: null,
          },
        ],
      },
    ]);

    const res = await service.list(admin, {
      categoryId: 'cat-1',
      search: '15P',
    });

    const findCall = (
      productFindMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown>; orderBy: Record<string, string> }]
      >
    )[0][0];
    expect(findCall.where).toEqual({
      businessId: 'biz-1',
      deletedAt: null,
      categoryId: 'cat-1',
      OR: [
        { name: { contains: '15P', mode: 'insensitive' } },
        { description: { contains: '15P', mode: 'insensitive' } },
        {
          variants: {
            some: {
              deletedAt: null,
              OR: [
                { sku: { contains: '15P', mode: 'insensitive' } },
                { barcode: { contains: '15P', mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
    expect(findCall.orderBy).toEqual({ name: 'asc' });
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('iPhone 15 Pro');
  });

  it('soft-deletes product with __del_ suffix on name', async () => {
    productFindFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'iPhone 15 Pro',
    });

    const res = await service.remove(admin, 'prod-1');

    expect(res.id).toBe('prod-1');
    expect(res.deletedAt).toBeInstanceOf(Date);
    const updateCall = (
      productUpdate.mock.calls as unknown as Array<
        [{ where: { id: string }; data: { name: string; deletedAt: Date } }]
      >
    )[0][0];
    expect(updateCall.where.id).toBe('prod-1');
    expect(updateCall.data.name).toMatch(/^iPhone 15 Pro__del_\d+$/);
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when soft-deleting non-existent product', async () => {
    productFindFirst.mockResolvedValue(null);

    await expect(service.remove(admin, 'prod-unknown')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('filters product list by requestedBusinessId for multi-business Admin', async () => {
    productFindMany.mockResolvedValue([]);

    await service.list(admin, { businessId: 'biz-2' });

    const findCall = (
      productFindMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown> }]
      >
    )[0][0];
    expect(findCall.where.businessId).toBe('biz-2');
  });

  it('scopes Cashier to token businessId and location stock', async () => {
    const cashier = {
      sub: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-cashier',
      locationId: 'loc-branch-1',
    };

    productFindMany.mockResolvedValue([
      {
        id: 'prod-1',
        name: 'iPhone 15 Pro',
        description: 'Flagship phone',
        categoryId: 'cat-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        category: null,
        variants: [
          {
            id: 'var-1',
            name: '128GB',
            sku: 'IPH-128',
            stock: 100, // global aggregate
            locationStocks: [
              { locationId: 'loc-branch-1', stock: 15 },
              { locationId: 'loc-branch-2', stock: 85 },
            ],
          },
        ],
      },
    ]);

    const res = await service.list(cashier, { businessId: 'biz-attempt-bypass' });

    const findCall = (
      productFindMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown> }]
      >
    )[0][0];
    // Cashier cannot bypass businessId from query; token is used
    expect(findCall.where.businessId).toBe('biz-cashier');
    expect(findCall.where.isActive).toBe(true);
    // Stock is resolved specifically for cashier branch location
    expect(res[0].variants[0].stock).toBe(15);
  });
});
