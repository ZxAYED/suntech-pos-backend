import { ForbiddenException } from '@nestjs/common';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import { OfflineService } from './offline.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {
    get(key: string) {
      if (key === 'OFFLINE_MAX_FUTURE_SKEW_SECONDS') return 300;
      return undefined;
    }
  },
}));

describe('OfflineService', () => {
  const userFindFirst = jest.fn();
  const businessFindFirst = jest.fn();
  const locationFindFirst = jest.fn();
  const categoryFindMany = jest.fn();
  const tx = {
    user: { findFirst: userFindFirst },
    business: { findFirst: businessFindFirst },
    location: { findFirst: locationFindFirst },
    category: { findMany: categoryFindMany },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const service = new OfflineService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      fullName: 'Cashier',
      role: Role.CASHIER,
      businessId: 'stale-business',
      locationId: 'stale-location',
    });
    businessFindFirst.mockResolvedValue({ id: 'biz-1', name: 'Shop' });
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      name: 'Main',
      businessId: 'biz-1',
    });
    categoryFindMany.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Phones',
        products: [
          {
            id: 'product-1',
            name: 'Phone',
            variants: [
              {
                id: 'variant-1',
                name: 'Blue',
                sellingPrice: 1000,
                images: [{ url: 'https://cdn.example/item.jpg', sortOrder: 0 }],
                locationStocks: [{ stock: -2 }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('returns a token-scoped catalog snapshot with branch stock', async () => {
    const snapshot = await service.bootstrap({
      sub: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-1',
      locationId: 'loc-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(locationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'loc-1', businessId: 'biz-1' }),
      }),
    );
    expect(snapshot.businessTimezone).toBe('Asia/Dhaka');
    expect(snapshot.maxFutureSkewSeconds).toBe(300);
    expect(snapshot.user).toEqual(
      expect.objectContaining({ businessId: 'biz-1', locationId: 'loc-1' }),
    );
    expect(snapshot.paymentMethods).toEqual(Object.values(PaymentMethod));
    expect(snapshot.categories[0].products[0].variants[0]).toEqual(
      expect.objectContaining({ stock: -2, sellingPrice: 1000 }),
    );
    expect(
      'locationStocks' in snapshot.categories[0].products[0].variants[0],
    ).toBe(false);
  });

  it('requires business and location to come from the JWT', async () => {
    await expect(
      service.bootstrap({ sub: 'cashier-1', role: Role.CASHIER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
