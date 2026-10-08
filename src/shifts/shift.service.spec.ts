import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, ShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftService } from './shift.service';

describe('ShiftService', () => {
  const locationFindFirst = jest.fn();
  const shiftFindFirst = jest.fn();
  const shiftCreate = jest.fn();
  const shiftUpdateMany = jest.fn();
  const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
    callback({
      location: { findFirst: locationFindFirst },
      shiftSession: { findFirst: shiftFindFirst, create: shiftCreate },
    }),
  );
  const prisma = {
    $transaction: transaction,
    shiftSession: {
      findFirst: shiftFindFirst,
      updateMany: shiftUpdateMany,
      findFirstOrThrow: jest.fn(),
    },
  } as unknown as PrismaService;
  const service = new ShiftService(prisma);
  const cashier = {
    sub: 'cashier-1',
    role: Role.CASHIER,
    businessId: 'biz-1',
    locationId: 'loc-1',
  };

  beforeEach(() => {
    locationFindFirst.mockReset();
    shiftFindFirst.mockReset();
    shiftCreate.mockReset();
    shiftUpdateMany.mockReset();
    locationFindFirst.mockResolvedValue({ id: 'loc-1' });
    shiftFindFirst.mockResolvedValue(null);
    shiftCreate.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'shift-1', ...data }),
    );
  });

  it('opens a shift for the cashier location on the token', async () => {
    await service.open(cashier, { startingAmount: 5000 });

    expect(shiftCreate).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        locationId: 'loc-1',
        cashierId: 'cashier-1',
        startingAmount: 5000,
        status: ShiftStatus.OPEN,
      },
      select: expect.any(Object) as object,
    });
  });

  it('rejects a second open shift', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-open' });

    await expect(
      service.open(cashier, { startingAmount: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftCreate).not.toHaveBeenCalled();
  });

  it('does not close a shift owned by another cashier', async () => {
    shiftFindFirst.mockResolvedValue(null);

    await expect(
      service.close(cashier, 'shift-2', { closingAmount: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shiftFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'shift-2',
        businessId: 'biz-1',
        cashierId: 'cashier-1',
      },
      select: { id: true, status: true },
    });
    expect(shiftUpdateMany).not.toHaveBeenCalled();
  });
});
