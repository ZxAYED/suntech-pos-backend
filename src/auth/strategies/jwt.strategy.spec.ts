import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: () => class PassportStrategy {},
}));
jest.mock('passport-jwt', () => ({ Strategy: class Strategy {} }));

describe('JwtStrategy', () => {
  const userFindFirst = jest.fn();
  const locationFindFirst = jest.fn();
  const prisma = {
    user: { findFirst: userFindFirst },
    location: { findFirst: locationFindFirst },
  } as unknown as PrismaService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue('test-access-secret'),
  } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, prisma);

  beforeEach(() => {
    userFindFirst.mockReset();
    locationFindFirst.mockReset();
  });

  it('rejects deleted or unknown users even when the JWT is valid', async () => {
    userFindFirst.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user', role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive users', async () => {
    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-1',
      role: Role.CASHIER,
      status: AccountStatus.SUSPENDED,
      businessId: 'biz-1',
      locationId: 'loc-1',
      ownedBusinesses: [],
    });

    await expect(
      strategy.validate({ sub: 'cashier-1', role: Role.CASHIER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rebuilds cashier scope from current database assignments', async () => {
    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-1',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      businessId: 'biz-current',
      locationId: 'loc-current',
      ownedBusinesses: [],
    });
    locationFindFirst.mockResolvedValue({ id: 'loc-current' });

    await expect(
      strategy.validate({
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-stale',
        locationId: 'loc-stale',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        businessId: 'biz-current',
        locationId: 'loc-current',
        businessIds: ['biz-current'],
        locationIds: ['loc-current'],
      }),
    );
  });

  it('rebuilds admin ownership arrays from active businesses', async () => {
    userFindFirst.mockResolvedValue({
      id: 'admin-1',
      publicId: 'ADM-1',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      businessId: 'biz-1',
      locationId: null,
      ownedBusinesses: [
        { id: 'biz-1', locations: [{ id: 'loc-1' }] },
        { id: 'biz-2', locations: [{ id: 'loc-2' }] },
      ],
    });

    await expect(
      strategy.validate({ sub: 'admin-1', role: Role.ADMIN }),
    ).resolves.toEqual(
      expect.objectContaining({
        businessId: 'biz-1',
        businessIds: ['biz-1', 'biz-2'],
        locationIds: ['loc-1', 'loc-2'],
      }),
    );
  });
});
