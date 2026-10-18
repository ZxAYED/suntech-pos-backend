import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
    });
    expect(res.name).toBe('iPhone 15 Pro');
    expect(res.category).toEqual({ id: 'cat-1', name: 'Electronics' });
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
});
