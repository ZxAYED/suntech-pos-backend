import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IdGeneratorService } from '../identity/id-generator.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './user.service';

describe('UserService', () => {
  const locationFindFirst = jest.fn();
  const userCreate = jest.fn();
  const withUniquePublicId = jest.fn();
  const prisma = {
    location: { findFirst: locationFindFirst },
    user: { create: userCreate },
  } as unknown as PrismaService;
  const idGenerator = {
    withUniquePublicId,
  } as unknown as IdGeneratorService;
  const service = new UserService(prisma, idGenerator);

  beforeEach(() => {
    locationFindFirst.mockReset();
    userCreate.mockReset();
  });

  it('does not create a cashier when the location is outside the business', async () => {
    locationFindFirst.mockResolvedValue(null);

    await expect(
      service.createCashier(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        {
          fullName: 'Rafi',
          password: 'password123',
          locationId: 'other-location',
          monthlySalary: 20000,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(locationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-location',
        businessId: 'biz-1',
        deletedAt: null,
      },
    });
    expect(withUniquePublicId).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });
});
