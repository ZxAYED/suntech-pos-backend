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
  const categoryDelete = jest.fn();
  const productCount = jest.fn();
  const orderLineFindMany = jest.fn();
  const orderLineCount = jest.fn();

  const prisma = {
    $transaction: jest.fn((callback) => callback(prisma)),
    category: {
      findFirst: categoryFindFirst,
      findMany: categoryFindMany,
      create: categoryCreate,
      update: categoryUpdate,
      updateMany: categoryUpdateMany,
      delete: categoryDelete,
    },
    product: {
      count: productCount,
    },
    orderLine: {
      findMany: orderLineFindMany,
      count: orderLineCount,
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
    categoryDelete.mockReset();
    productCount.mockReset();
    orderLineFindMany.mockReset();
    orderLineCount.mockReset();

    categoryFindFirst.mockResolvedValue(null);
    productCount.mockResolvedValue(0);
    orderLineCount.mockResolvedValue(0);
    categoryCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'cat-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true,
          ...data,
        }),
    );
    categoryUpdate.mockResolvedValue({ id: 'cat-1' });
    categoryUpdateMany.mockResolvedValue({ count: 1 });
    categoryDelete.mockResolvedValue({ id: 'cat-1' });
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
      isActive: true,
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

  it('rejects creating a category when an archived category with the same name exists', async () => {
    categoryFindFirst.mockResolvedValueOnce({
      id: 'cat-archived-1',
      name: 'Smartphones',
      slug: 'smartphones',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await expect(
      service.create(admin, {
        name: 'Smartphones',
        description: 'New smartphones',
      }),
    ).rejects.toThrow(ConflictException);
    expect(categoryCreate).not.toHaveBeenCalled();
    expect(categoryUpdate).not.toHaveBeenCalled();
  });

  it('lists categories enriched with activeSkus, totalUnits, inventoryValue and sales metrics', async () => {
    categoryFindMany.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Smartphones',
        slug: 'smartphones',
        description: 'Phones',
        isActive: true,
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
    expect(cat.status).toBe('ACTIVE');
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
      isActive: true,
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
    expect(cat.status).toBe('ACTIVE');
  });

  it('blocks category deletion when active products exist under it', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-1',
      name: 'Audio & Headphones',
      slug: 'audio-headphones',
    });
    productCount.mockResolvedValue(2);

    await expect(service.remove(admin, 'cat-1')).rejects.toThrow(
      ConflictException,
    );
    expect(categoryUpdate).not.toHaveBeenCalled();
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it('rejects deletion of a category with sold archived products', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-sold', name: 'Sold Category', slug: 'sold-category',
    });
    productCount.mockResolvedValue(0);
    orderLineCount.mockResolvedValue(1);

    await expect(service.remove(admin, 'cat-sold')).rejects.toThrow(
      ConflictException,
    );
    expect(orderLineCount).toHaveBeenCalledWith({
      where: {
        variantId: { not: null },
        order: { location: { businessId: 'biz-1' } },
        OR: [
          { variant: { is: { product: { is: { categoryId: 'cat-sold', businessId: 'biz-1' } } } } },
          { categoryName: { equals: 'Sold Category', mode: 'insensitive' } },
        ],
      },
    });
    expect(categoryUpdate).not.toHaveBeenCalled();
  });

  it('archives category without renaming human-facing name or slug', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-1',
      name: 'Smartphones',
      slug: 'smartphones',
    });
    productCount.mockResolvedValue(0);

    const res = await service.remove(admin, 'cat-1');

    expect(res.id).toBe('cat-1');
    expect(res.deletedAt).toBeInstanceOf(Date);
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: {
        isActive: false,
        deletedAt: expect.any(Date),
      },
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it('archives category without physical delete even when zero sales history exists', async () => {
    categoryFindFirst.mockResolvedValue({
      id: 'cat-mistake',
      name: 'Typo Category',
      slug: 'typo-category',
    });
    productCount.mockResolvedValue(0);

    const res = await service.remove(admin, 'cat-mistake');

    expect(res.id).toBe('cat-mistake');
    expect(categoryDelete).not.toHaveBeenCalled();
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'cat-mistake' },
      data: {
        isActive: false,
        deletedAt: expect.any(Date),
      },
    });
  });

  it('throws NotFoundException when deleting non-existent category', async () => {
    categoryFindFirst.mockResolvedValue(null);

    await expect(service.remove(admin, 'cat-unknown')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
