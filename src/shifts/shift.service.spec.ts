import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, ShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isPreviousCalendarDay, ShiftService } from './shift.service';

describe('ShiftService', () => {
  const locationFindFirst = jest.fn();
  const shiftFindFirst = jest.fn();
  const shiftCreate = jest.fn();
  const shiftUpdate = jest.fn();
  const shiftUpdateMany = jest.fn();
  const shiftFindFirstOrThrow = jest.fn();
  const shiftCount = jest.fn();
  const shiftFindMany = jest.fn();
  const userFindFirst = jest.fn();
  const orderAggregate = jest.fn();
  const advanceAggregate = jest.fn();
  const advanceFindMany = jest.fn();

  const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
    callback({
      location: { findFirst: locationFindFirst },
      shiftSession: {
        findFirst: shiftFindFirst,
        findMany: shiftFindMany,
        create: shiftCreate,
        update: shiftUpdate,
        updateMany: shiftUpdateMany,
        findFirstOrThrow: shiftFindFirstOrThrow,
      },
      user: { findFirst: userFindFirst },
      order: { aggregate: orderAggregate },
      employeeAdvance: {
        aggregate: advanceAggregate,
        findMany: advanceFindMany,
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalRefund: 0 } }),
      },
    }),
  );
  const prisma = {
    $transaction: transaction,
    location: {
      findFirst: locationFindFirst,
      findUnique: locationFindFirst,
    },
    user: {
      findFirst: userFindFirst,
    },
    shiftSession: {
      findFirst: shiftFindFirst,
      updateMany: shiftUpdateMany,
      findFirstOrThrow: shiftFindFirstOrThrow,
      count: shiftCount,
      findMany: shiftFindMany,
    },
    order: {
      aggregate: orderAggregate,
    },
    employeeAdvance: {
      aggregate: advanceAggregate,
      findMany: advanceFindMany,
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
    shiftUpdate.mockReset();
    shiftUpdateMany.mockReset();
    shiftFindFirstOrThrow.mockReset();
    shiftCount.mockReset();
    shiftFindMany.mockReset();
    userFindFirst.mockReset();
    orderAggregate.mockReset();
    advanceAggregate.mockReset();
    advanceFindMany.mockReset();

    locationFindFirst.mockResolvedValue({ id: 'loc-1', businessId: 'biz-1' });
    shiftFindFirst.mockResolvedValue(null);
    shiftFindMany.mockResolvedValue([]);
    shiftCreate.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'shift-1', ...data }),
    );
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 24820 } });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 1350 } });
    advanceFindMany.mockResolvedValue([
      {
        id: 'adv-1',
        amount: 350,
        reason: 'Lunch',
        takenAt: new Date(),
        status: 'PENDING',
      },
      {
        id: 'adv-2',
        amount: 1000,
        reason: 'Emergency',
        takenAt: new Date(),
        status: 'PENDING',
      },
    ]);
  });

  it('opens a first shift for the cashier location on the token', async () => {
    const result = await service.open(cashier, { startingAmount: 5000 });

    expect(shiftCreate).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        locationId: 'loc-1',
        cashierId: 'cashier-1',
        startingAmount: 5000,
        status: ShiftStatus.OPEN,
        openedAt: expect.any(Date),
      },
      select: expect.any(Object) as object,
    });
    expect(result.status).toBe(ShiftStatus.OPEN);
    expect(result.isOverdue).toBe(false);
  });

  it('rejects a second shift if already opened today (when existing shift is OPEN)', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-open-today',
      status: ShiftStatus.OPEN,
      openedAt: new Date(),
    });

    await expect(
      service.open(cashier, { startingAmount: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftCreate).not.toHaveBeenCalled();
  });

  it('rejects a second shift if already opened today even if existing shift is CLOSED', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-closed-today',
      status: ShiftStatus.CLOSED,
      openedAt: new Date(),
    });

    await expect(
      service.open(cashier, { startingAmount: 2000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftCreate).not.toHaveBeenCalled();
  });

  it('rejects a same-day second shift even if autoClosePrevious is true', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-today',
      status: ShiftStatus.OPEN,
      openedAt: new Date(),
    });

    await expect(
      service.open(cashier, {
        startingAmount: 2000,
        autoClosePrevious: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftUpdate).not.toHaveBeenCalled();
    expect(shiftCreate).not.toHaveBeenCalled();
  });

  it('automatically closes older open shift from previous day and opens new shift (without requiring autoClosePrevious flag)', async () => {
    // sameDayShift check returns null
    shiftFindFirst.mockResolvedValue(null);
    // olderOpenShifts returns one older open shift
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    shiftFindMany.mockResolvedValueOnce([
      {
        id: 'shift-yesterday',
        startingAmount: 2000,
        notes: 'Cashier initial note',
      },
    ]);
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 8000 } });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 500 } });

    const result = await service.open(cashier, {
      startingAmount: 3000,
    });

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift-yesterday' },
      data: expect.objectContaining({
        status: ShiftStatus.CLOSED,
        closingAmount: null,
        expectedAmount: 9500,
        variance: null,
        cashSales: 8000,
        advancesOut: 500,
        autoCloseReason: 'AUTO_CLOSED_PRIOR_DAY_UNCOUNTED',
      }),
    });
    // Check that existing notes were preserved (not overwritten)
    const updateData = shiftUpdate.mock.calls[0][0].data;
    expect(updateData.notes).toBeUndefined();

    expect(shiftCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        locationId: 'loc-1',
        cashierId: 'cashier-1',
        startingAmount: 3000,
        status: ShiftStatus.OPEN,
      }),
      select: expect.any(Object),
    });
    expect(result.autoClosedPreviousShiftId).toBe('shift-yesterday');
    expect(result.autoClosedPreviousShiftIds).toEqual(['shift-yesterday']);
  });

  it('automatically closes several legacy older open shifts and tracks autoClosedPreviousShiftIds', async () => {
    shiftFindFirst.mockResolvedValue(null);
    shiftFindMany.mockResolvedValueOnce([
      { id: 'shift-old-1', startingAmount: 1000 },
      { id: 'shift-old-2', startingAmount: 2000 },
    ]);
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 0 } });

    const result = await service.open(cashier, { startingAmount: 5000 });

    expect(shiftUpdate).toHaveBeenCalledTimes(2);
    expect(result.autoClosedPreviousShiftIds).toEqual([
      'shift-old-1',
      'shift-old-2',
    ]);
    expect(result.autoClosedPreviousShiftId).toBeUndefined();
  });

  it('handles P2034 serialization conflict by throwing ConflictException', async () => {
    const p2034Error = new Prisma.PrismaClientKnownRequestError('Conflict', {
      code: 'P2034',
      clientVersion: '6.0.0',
    });
    transaction.mockRejectedValueOnce(p2034Error);

    await expect(
      service.open(cashier, { startingAmount: 5000 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists shifts scoped to cashier location and cashierId with derived flags', async () => {
    shiftCount.mockResolvedValue(1);
    shiftFindMany.mockResolvedValue([
      {
        id: 'shift-1',
        status: ShiftStatus.OPEN,
        openedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // Overdue
        closingAmount: null,
      },
    ]);

    const result = await service.list(cashier, { page: 1, limit: 10 });

    expect(shiftFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        locationId: 'loc-1',
        cashierId: 'cashier-1',
      },
      select: expect.any(Object),
      orderBy: { openedAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].isOverdue).toBe(true);
    expect(result.data[0].closingCashNotProvided).toBe(false);
  });

  it('rejects a cashier filtering another cashier data in list', async () => {
    await expect(
      service.list(cashier, { cashierId: 'other-cashier' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows admin to filter shifts by cashierId when cashier belongs to business', async () => {
    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
    };
    userFindFirst.mockResolvedValue({ id: 'cashier-1' });
    shiftCount.mockResolvedValue(1);
    shiftFindMany.mockResolvedValue([
      {
        id: 'shift-1',
        status: ShiftStatus.CLOSED,
        openedAt: new Date(),
        closingAmount: null,
      },
    ]);

    const result = await service.list(admin, {
      cashierId: 'cashier-1',
      page: 1,
      limit: 10,
    });

    expect(result.data[0].closingCashNotProvided).toBe(true);
    expect(shiftFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cashierId: 'cashier-1',
        }),
      }),
    );
  });

  it('throws BadRequestException if admin filters shifts by cashier from another business', async () => {
    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
    };
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.list(admin, { cashierId: 'foreign-cashier' }),
    ).rejects.toThrow('Cashier does not belong to the specified business');
  });

  it('filters shifts by fromDate and toDate correctly in Dhaka timezone', async () => {
    shiftCount.mockResolvedValue(1);
    shiftFindMany.mockResolvedValue([]);

    await service.list(cashier, {
      fromDate: '2026-11-01',
      toDate: '2026-11-05',
    });

    expect(shiftFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          openedAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('throws BadRequestException if fromDate is after toDate', async () => {
    await expect(
      service.list(cashier, {
        fromDate: '2026-11-06',
        toDate: '2026-11-01',
      }),
    ).rejects.toThrow('fromDate cannot be after toDate');
  });

  it('throws BadRequestException if fromDate has invalid format', async () => {
    await expect(
      service.list(cashier, {
        fromDate: 'invalid-date',
      }),
    ).rejects.toThrow('Invalid fromDate format. Expected YYYY-MM-DD');
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
      select: { id: true, startingAmount: true, status: true, notes: true },
    });
    expect(shiftUpdateMany).not.toHaveBeenCalled();
  });

  it('returns active shift with live computed expected cash and advance ledger', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-1',
      businessId: 'biz-1',
      startingAmount: 10000,
      status: ShiftStatus.OPEN,
      openedAt: new Date(),
    });

    const active = await service.getActive(cashier);

    expect(active).not.toBeNull();
    expect(active?.openingFloat).toBe(10000);
    expect(active?.cashSales).toBe(24820);
    expect(active?.advancesOut).toBe(1350);
    expect(active?.expectedCash).toBe(33470);
    expect(active?.advanceLedger).toHaveLength(2);
    expect(active?.isOverdue).toBe(false);
  });

  it('closes active shift, calculates expected cash and variance', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-1',
      startingAmount: 10000,
      status: ShiftStatus.OPEN,
    });
    shiftUpdateMany.mockResolvedValue({ count: 1 });
    shiftFindFirstOrThrow.mockResolvedValue({
      id: 'shift-1',
      closingAmount: 33470,
      expectedAmount: 33470,
      variance: 0,
      status: ShiftStatus.CLOSED,
    });

    const closed = await service.close(cashier, undefined, {
      closingAmount: 33470,
      notes: 'Balanced',
    });

    expect(shiftUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'shift-1',
        businessId: 'biz-1',
        status: ShiftStatus.OPEN,
      },
      data: expect.objectContaining({
        closingAmount: 33470,
        expectedAmount: 33470,
        variance: 0,
        cashSales: 24820,
        advancesOut: 1350,
        notes: 'Balanced',
        status: ShiftStatus.CLOSED,
      }),
    });
    expect(closed.status).toBe(ShiftStatus.CLOSED);
  });

  it('preserves opening notes when closing notes are omitted', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-1',
      businessId: 'biz-1',
      startingAmount: 10000,
      status: ShiftStatus.OPEN,
      notes: 'Opening float verified',
    });
    shiftUpdateMany.mockResolvedValue({ count: 1 });
    shiftFindFirstOrThrow.mockResolvedValue({
      id: 'shift-1',
      status: ShiftStatus.CLOSED,
      notes: 'Opening float verified',
    });

    await service.close(cashier, undefined, {
      closingAmount: 10000,
    });

    expect(shiftUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'shift-1',
        businessId: 'biz-1',
        status: ShiftStatus.OPEN,
      },
      data: expect.objectContaining({
        notes: 'Opening float verified',
      }),
    });
  });

  it('closes an overdue open shift through the normal counted close path', async () => {
    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    shiftFindFirst.mockResolvedValue({
      id: 'shift-overdue',
      startingAmount: 5000,
      status: ShiftStatus.OPEN,
      openedAt: pastDate,
    });
    shiftUpdateMany.mockResolvedValue({ count: 1 });
    shiftFindFirstOrThrow.mockResolvedValue({
      id: 'shift-overdue',
      closingAmount: 6000,
      expectedAmount: 5500,
      variance: 500,
      status: ShiftStatus.CLOSED,
    });

    const closed = await service.close(cashier, 'shift-overdue', {
      closingAmount: 6000,
      notes: 'Late reconciliation with physical count',
    });

    expect(closed.status).toBe(ShiftStatus.CLOSED);
    expect(shiftUpdateMany).toHaveBeenCalled();
  });

  describe('isPreviousCalendarDay', () => {
    it('returns false when opened earlier on the same day in Asia/Dhaka even across UTC date boundary', () => {
      // 2:00 AM on 2026-10-19 in Asia/Dhaka is 2026-10-18T20:00:00Z in UTC
      const openedAt = new Date('2026-10-18T20:00:00Z');
      // 4:00 PM on 2026-10-19 in Asia/Dhaka is 2026-10-19T10:00:00Z in UTC
      const now = new Date('2026-10-19T10:00:00Z');
      expect(isPreviousCalendarDay(openedAt, now)).toBe(false);
    });

    it('returns true when opened on a previous calendar day in Asia/Dhaka', () => {
      // 11:00 PM on 2026-10-18 in Asia/Dhaka is 2026-10-18T17:00:00Z in UTC
      const openedAt = new Date('2026-10-18T17:00:00Z');
      // 4:00 PM on 2026-10-19 in Asia/Dhaka is 2026-10-19T10:00:00Z in UTC
      const now = new Date('2026-10-19T10:00:00Z');
      expect(isPreviousCalendarDay(openedAt, now)).toBe(true);
    });
  });
});
