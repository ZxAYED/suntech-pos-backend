import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role, ShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isPreviousCalendarDay, ShiftService } from './shift.service';

describe('ShiftService', () => {
  const userFindFirst = jest.fn();
  const locationFindFirst = jest.fn();
  const shiftFindFirst = jest.fn();
  const shiftCreate = jest.fn();
  const shiftUpdate = jest.fn();
  const shiftUpdateMany = jest.fn();
  const shiftFindFirstOrThrow = jest.fn();
  const shiftCount = jest.fn();
  const shiftFindMany = jest.fn();
  const orderAggregate = jest.fn();
  const advanceAggregate = jest.fn();
  const advanceFindMany = jest.fn();
  const advanceCreate = jest.fn();
  const payrollRecordFindFirst = jest.fn();

  const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
    callback({
      location: { findFirst: locationFindFirst },
      shiftSession: {
        findFirst: shiftFindFirst,
        create: shiftCreate,
        update: shiftUpdate,
      },
      order: { aggregate: orderAggregate },
      employeeAdvance: { aggregate: advanceAggregate, create: advanceCreate },
      payrollRecord: { findFirst: payrollRecordFindFirst },
    }),
  );
  const prisma = {
    $transaction: transaction,
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
      create: advanceCreate,
    },
    payrollRecord: {
      findFirst: payrollRecordFindFirst,
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
    userFindFirst.mockReset();
    locationFindFirst.mockReset();
    shiftFindFirst.mockReset();
    shiftCreate.mockReset();
    shiftUpdate.mockReset();
    shiftUpdateMany.mockReset();
    shiftFindFirstOrThrow.mockReset();
    shiftCount.mockReset();
    shiftFindMany.mockReset();
    orderAggregate.mockReset();
    advanceAggregate.mockReset();
    advanceFindMany.mockReset();
    advanceCreate.mockReset();
    payrollRecordFindFirst.mockReset();

    userFindFirst.mockResolvedValue({ monthlySalary: 50000 });
    locationFindFirst.mockResolvedValue({ id: 'loc-1' });
    shiftFindFirst.mockResolvedValue(null);
    payrollRecordFindFirst.mockResolvedValue(null);
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

  it('rejects a second open shift if opened today and autoClosePrevious is false', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-open',
      openedAt: new Date(),
    });

    await expect(
      service.open(cashier, { startingAmount: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftCreate).not.toHaveBeenCalled();
  });

  it('automatically closes a shift left open from a previous day and opens a new shift', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    shiftFindFirst.mockResolvedValue({
      id: 'shift-yesterday',
      startingAmount: 2000,
      openedAt: yesterday,
    });
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 8000 } });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 500 } });

    const result = await service.open(cashier, { startingAmount: 3000 });

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift-yesterday' },
      data: expect.objectContaining({
        status: ShiftStatus.CLOSED,
        closingAmount: 9500, // 2000 + 8000 - 500
        expectedAmount: 9500,
        variance: 0,
        cashSales: 8000,
        advancesOut: 500,
        notes:
          'Auto-closed: previous shift was left open before new shift start',
      }),
    });
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
  });

  it('rejects a cashier from auto-closing a same-day shift even if autoClosePrevious is true', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-today',
      startingAmount: 1000,
      openedAt: new Date(),
    });

    await expect(
      service.open(cashier, {
        startingAmount: 2000,
        autoClosePrevious: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftUpdate).not.toHaveBeenCalled();
  });

  it('allows an admin to auto-close today shift if autoClosePrevious is explicitly requested', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-today',
      startingAmount: 1000,
      openedAt: new Date(),
    });
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 4000 } });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 0 } });

    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
      locationId: 'loc-1',
    };
    const result = await service.open(admin, {
      startingAmount: 2000,
      autoClosePrevious: true,
    });

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift-today' },
      data: expect.objectContaining({
        status: ShiftStatus.CLOSED,
        closingAmount: 5000,
        expectedAmount: 5000,
      }),
    });
    expect(result.autoClosedPreviousShiftId).toBe('shift-today');
  });

  it('lists shifts scoped to cashier location and cashierId', async () => {
    shiftCount.mockResolvedValue(1);
    shiftFindMany.mockResolvedValue([{ id: 'shift-1' }]);

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
  });

  it('lists shifts for admin with locationId filter', async () => {
    shiftCount.mockResolvedValue(1);
    shiftFindMany.mockResolvedValue([{ id: 'shift-1' }]);
    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
    };

    const result = await service.list(admin, {
      locationId: 'loc-1',
      page: 1,
      limit: 10,
    });

    expect(shiftFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        locationId: 'loc-1',
      },
      select: expect.any(Object),
      orderBy: { openedAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect(result.data).toHaveLength(1);
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
      select: { id: true, startingAmount: true, status: true },
    });
    expect(shiftUpdateMany).not.toHaveBeenCalled();
  });

  it('returns active shift with live computed expected cash and advance ledger', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift-1',
      businessId: 'biz-1',
      startingAmount: 10000,
      status: ShiftStatus.OPEN,
    });

    const active = await service.getActive(cashier);

    expect(active).not.toBeNull();
    expect(active?.openingFloat).toBe(10000);
    expect(active?.cashSales).toBe(24820);
    expect(active?.advancesOut).toBe(1350);
    expect(active?.expectedCash).toBe(33470);
    expect(active?.advanceLedger).toHaveLength(2);
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

  it('adds an advance to the active shift', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-1' });
    advanceCreate.mockResolvedValue({
      id: 'adv-3',
      amount: 500,
      reason: 'Snacks',
      takenAt: new Date(),
      status: 'PENDING',
    });

    const adv = await service.addAdvance(cashier, {
      amount: 500,
      reason: 'Snacks',
    });

    expect(advanceCreate).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        cashierId: 'cashier-1',
        shiftId: 'shift-1',
        amount: 500,
        reason: 'Snacks',
      },
      select: expect.any(Object),
    });
    expect(adv.amount).toBe(500);
  });

  it('rejects shift advance when requested amount exceeds remaining monthly salary limit', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-1', startingAmount: 10000 });
    userFindFirst.mockResolvedValue({ monthlySalary: 10000 });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 8000 } });

    await expect(
      service.addAdvance(cashier, {
        amount: 3000,
        reason: 'Over salary cap',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows shift advance when within monthlySalary even if exceeding drawer cash', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-1', startingAmount: 1000 });
    userFindFirst.mockResolvedValue({ monthlySalary: 50000 });
    advanceAggregate.mockResolvedValue({ _sum: { amount: 0 } });
    advanceCreate.mockResolvedValue({
      id: 'adv-new',
      amount: 2000,
      reason: 'Exceeds drawer cash but allowed by salary',
      status: 'PENDING',
    });

    const adv = await service.addAdvance(cashier, {
      amount: 2000,
      reason: 'Exceeds drawer cash but allowed by salary',
    });
    expect(adv.amount).toBe(2000);
  });

  it('rejects shift advance when cashier has no positive monthly salary configured', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-1', startingAmount: 10000 });
    userFindFirst.mockResolvedValue({ monthlySalary: 0 });

    await expect(
      service.addAdvance(cashier, {
        amount: 1000,
        reason: 'No salary',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects shift advance when current month payroll is already settled', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift-1', startingAmount: 10000 });
    userFindFirst.mockResolvedValue({ monthlySalary: 30000 });
    payrollRecordFindFirst.mockResolvedValue({ id: 'pr-1', status: 'PAID' });

    await expect(
      service.addAdvance(cashier, {
        amount: 1000,
        reason: 'Settled month',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
