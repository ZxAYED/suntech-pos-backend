import { ConflictException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VariantService } from './variant.service';

describe('VariantService', () => {
  const productFindFirst = jest.fn();
  const variantFindFirst = jest.fn();
  const variantCreate = jest.fn();
  const prisma = {
    product: { findFirst: productFindFirst },
    variant: { findFirst: variantFindFirst, create: variantCreate },
  } as unknown as PrismaService;
  const service = new VariantService(prisma);
  const admin = { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' };

  beforeEach(() => {
    productFindFirst.mockReset();
    variantFindFirst.mockReset();
    variantCreate.mockReset();
    productFindFirst.mockResolvedValue({ id: 'product-1' });
    variantFindFirst.mockResolvedValue(null);
  });

  it('mints a business sku when the admin omits one', async () => {
    variantCreate.mockImplementation(
      ({ data }: { data: { sku: string; businessId: string } }) =>
        Promise.resolve(data),
    );

    const created = await service.create(admin, {
      productId: 'product-1',
      name: 'Red',
      sellingPrice: 1500,
    });

    expect(created.businessId).toBe('biz-1');
    expect(created.sku).toMatch(/^PRD-[A-Z2-9]{6}$/);
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
