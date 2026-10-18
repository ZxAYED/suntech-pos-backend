import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryService } from './category.service';

describe('CategoryService', () => {
  const categoryFindFirst = jest.fn();
  const categoryFindMany = jest.fn();
  const categoryCreate = jest.fn();
  const categoryUpdate = jest.fn();
  const categoryUpdateMany = jest.fn();
  const orderLineFindMany = jest.fn();

  const prisma = {
    category: {
      findFirst: categoryFindFirst,
      findMany: categoryFindMany,
      create: categoryCreate,
      update: categoryUpdate,
      updateMany: categoryUpdateMany,
    },
    orderLine: {
      findMany: orderLineFindMany,
    },
  } as unknown as PrismaService;

  const service = new CategoryService(prisma);
  const admin = {
    sub: 'admin-1',
    role: Role.ADMIN,
    businessId: 'biz-1',
  };

  beforeEach(() => {
    categoryFindFirst.mockReset();
    categoryFindMany.mockReset();
    categoryCreate.mockReset();
    categoryUpdate.mockReset();
    categoryUpdateMany.mockReset();
    orderLineFindMany.mockReset();

    categoryFindFirst.mockResolvedValue(null);
    categoryCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'cat-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }),
    );
    categoryUpdate.mockResolvedValue({ id: 'cat-1' });
    categoryUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('creates a category with auto-generated slug when none provided', async () => {
    const res = await service.create(admin, {
      name: 'Smartphones & Tablets',
      description: 'Mobile devices',
    });

    const call = (
      categoryCreate.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0];
    expect(call.data).toEqual({
      businessId: 'biz-1',
      name: 'Smartphones & Tablets',
      slug: 'smartphones-tablets',
      description: 'Mobile devices',
    });
    expect(res.name).toBe('Smartphones & Tablets');
    expect(res.slug).toBe('smartphones-tablets');
  });

  it('rejects duplicate category name', async () => {
    categoryFindFirst.mockResolvedValue({ id: 'cat-existing' });

    await expect(
      service.create(admin, { name: 'Smartphones' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists categories enriched with activeSkus, totalUnits, inventoryValue and sales metrics', async () => {
    categoryFindMany.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Smartphones',
        slug: 'smartphones',
        description: 'Phones',
        createdAt: new Date(),
        updatedAt: new Date(),
        products: [
          {
            id: 'prod-1',
            variants: [
              { id: 'var-1', stock: 10, sellingPrice: 20000 },
              { id: 'var-2', stock: 5, sellingPrice: 30000 },
            ],
          },
        ],
      },
    ]);

    orderLineFindMany.mockResolvedValue([
      { variantId: 'var-1', quantity: 3, subtotal: 60000 },
      { variantId: 'var-2', quantity: 1, subtotal: 30000 },
    ]);

    const list = await service.list(admin);

    expect(list).toHaveLength(1);
    const cat = list[0];
    expect(cat.name).toBe('Smartphones');
    expect(cat.productsCount).toBe(1);
    expect(cat.activeSkus).toBe(2);
    expect(cat.totalUnits).toBe(15); // 10 + 5
    expect(cat.inventoryValue).toBe(350000); // 10*20000 + 5*30000
    expect(cat.salesCount).toBe(4); // 3 + 1
    expect(cat.salesRevenue).toBe(90000); // 60000 + 30000
  });

  it('filters categories by search keyword matching name or description', async () => {
    categoryFindMany.mockResolvedValue([]);

    await service.list(admin, 'smart');

    const findCall = (
      categoryFindMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown>; orderBy: Record<string, string> }]
      >
    )[0][0];
    expect(findCall.where).toEqual({
      businessId: 'biz-1',
      deletedAt: null,
      OR: [
        { name: { contains: 'smart', mode: 'insensitive' } },
        { description: { contains: 'smart', mode: 'insensitive' } },
      ],
    });
    expect(findCall.orderBy).toEqual({ name: 'asc' });
  });

  it('returns category with analytics in get()', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-1',
      name: 'Chargers',
      slug: 'chargers',
      description: 'Adapters',
      createdAt: new Date(),
      updatedAt: new Date(),
      products: [
        {
          id: 'prod-2',
          variants: [{ id: 'var-3', stock: 50, sellingPrice: 1000 }],
        },
      ],
    });
    orderLineFindMany.mockResolvedValue([{ quantity: 10, subtotal: 10000 }]);

    const cat = await service.get(admin, 'cat-1');

    expect(cat.name).toBe('Chargers');
    expect(cat.activeSkus).toBe(1);
    expect(cat.totalUnits).toBe(50);
    expect(cat.inventoryValue).toBe(50000);
    expect(cat.salesCount).toBe(10);
    expect(cat.salesRevenue).toBe(10000);
  });

  it('soft-deletes category with __del_ suffix on name and slug', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-1',
      name: 'Smartphones',
      slug: 'smartphones',
    });

    const res = await service.remove(admin, 'cat-1');

    expect(res.id).toBe('cat-1');
    expect(res.deletedAt).toBeInstanceOf(Date);
    const updateCall = (
      categoryUpdate.mock.calls as unknown as Array<
        [
          {
            where: { id: string };
            data: { name: string; slug: string; deletedAt: Date };
          },
        ]
      >
    )[0][0];
    expect(updateCall.where.id).toBe('cat-1');
    expect(updateCall.data.name).toMatch(/^Smartphones__del_\d+$/);
    expect(updateCall.data.slug).toMatch(/^smartphones__del_\d+$/);
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when soft-deleting non-existent category', async () => {
    categoryFindFirst.mockResolvedValue(null);

    await expect(service.remove(admin, 'cat-unknown')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
