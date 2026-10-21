import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { requireBusinessId } from '../hr/require-business-id';
import { resolveLocationScope } from '../common/utils/location-scope';
import { PrismaService } from '../prisma/prisma.service';
import { payrollPeriod } from '../hr/payroll-period';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CreateShiftAdvanceDto } from './dto/create-shift-advance.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { OpenShiftDto } from './dto/open-shift.dto';

const shiftSelect = {
  id: true,
  businessId: true,
  locationId: true,
  cashierId: true,
  startingAmount: true,
  closingAmount: true,
  expectedAmount: true,
  variance: true,
  cashSales: true,
  advancesOut: true,
  notes: true,
  status: true,
  openedAt: true,
  closedAt: true,
  cashier: {
    select: {
      id: true,
      fullName: true,
      publicId: true,
    },
  },
  location: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.ShiftSessionSelect;

export type PresentedShift = Prisma.ShiftSessionGetPayload<{
  select: typeof shiftSelect;
}> & {
  autoClosedPreviousShiftId?: string;
};

export interface ActiveShiftDetails extends PresentedShift {
  openingFloat: number;
  expectedCash: number;
  advanceLedger: Array<{
    id: string;
    amount: number;
    reason: string | null;
    takenAt: Date;
    status: string;
  }>;
}

const ALREADY_OPEN_TODAY = 'You already have an open shift today';

export function isPreviousCalendarDay(
  openedAt?: Date | null,
  now = new Date(),
): boolean {
  if (!openedAt) return false;
  const dateObj = openedAt instanceof Date ? openedAt : new Date(openedAt);
  if (isNaN(dateObj.getTime())) return false;
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });
  return dtf.format(dateObj) < dtf.format(now);
}

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async open(
    actor: AccessTokenPayload,
    dto: OpenShiftDto,
  ): Promise<PresentedShift> {
    const businessId = requireBusinessId(actor);
    const locationId = this.resolveOpenLocationId(actor, dto);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const location = await tx.location.findFirst({
            where: { id: locationId, businessId, deletedAt: null },
            select: { id: true },
          });

          if (!location) {
            throw new ForbiddenException(
              'Your location is no longer available',
            );
          }

          const openShift = await tx.shiftSession.findFirst({
            where: {
              businessId,
              cashierId: actor.sub,
              status: ShiftStatus.OPEN,
            },
            select: { id: true, startingAmount: true, openedAt: true },
          });

          let autoClosedPreviousShiftId: string | undefined;

          if (openShift) {
            const isStale =
              isPreviousCalendarDay(openShift.openedAt) ||
              (actor.role === Role.ADMIN && dto.autoClosePrevious === true);

            if (isStale) {
              const refundPromise = tx.refund?.aggregate
                ? tx.refund.aggregate({
                    where: {
                      order: {
                        shiftId: openShift.id,
                        paymentMethod: PaymentMethod.COD,
                      },
                    },
                    _sum: { totalRefund: true },
                  })
                : Promise.resolve({ _sum: { totalRefund: 0 } });

              const [cashOrdersAgg, advancesAgg, codRefundsAgg] =
                await Promise.all([
                  tx.order.aggregate({
                    where: {
                      shiftId: openShift.id,
                      paymentMethod: PaymentMethod.COD,
                      status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
                    },
                    _sum: { totalAmount: true },
                  }),
                  tx.employeeAdvance.aggregate({
                    where: {
                      shiftId: openShift.id,
                      businessId,
                      deletedAt: null,
                    },
                    _sum: { amount: true },
                  }),
                  refundPromise,
                ]);

              const rawCashSales = cashOrdersAgg?._sum?.totalAmount ?? 0;
              const codRefunds = codRefundsAgg?._sum?.totalRefund ?? 0;
              const cashSales = Math.max(0, rawCashSales - codRefunds);
              const advancesOut = advancesAgg?._sum?.amount ?? 0;
              const expectedAmount =
                (openShift.startingAmount ?? 0) + cashSales - advancesOut;

              await tx.shiftSession.update({
                where: { id: openShift.id },
                data: {
                  status: ShiftStatus.CLOSED,
                  closingAmount: expectedAmount,
                  expectedAmount,
                  variance: 0,
                  cashSales,
                  advancesOut,
                  notes:
                    'Auto-closed: previous shift was left open before new shift start',
                  closedAt: new Date(),
                },
              });

              autoClosedPreviousShiftId = openShift.id;
            } else {
              throw new ConflictException(ALREADY_OPEN_TODAY);
            }
          }

          const created = await tx.shiftSession.create({
            data: {
              businessId,
              locationId,
              cashierId: actor.sub,
              startingAmount: dto.startingAmount,
              status: ShiftStatus.OPEN,
            },
            select: shiftSelect,
          });

          return {
            ...created,
            ...(autoClosedPreviousShiftId ? { autoClosedPreviousShiftId } : {}),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(ALREADY_OPEN_TODAY);
      }

      throw error;
    }
  }

  async getActive(
    cashier: AccessTokenPayload,
  ): Promise<ActiveShiftDetails | null> {
    const businessId = requireBusinessId(cashier);

    const shift = await this.prisma.shiftSession.findFirst({
      where: {
        businessId,
        cashierId: cashier.sub,
        status: ShiftStatus.OPEN,
      },
      select: shiftSelect,
    });

    if (!shift) {
      return null;
    }

    const { cashSales, advancesOut, advanceLedger } =
      await this.computeShiftMetrics(shift.id, businessId);

    const expectedCash = shift.startingAmount + cashSales - advancesOut;

    return {
      ...shift,
      openingFloat: shift.startingAmount,
      cashSales,
      advancesOut,
      expectedCash,
      expectedAmount: expectedCash,
      advanceLedger,
    };
  }

  async close(
    cashier: AccessTokenPayload,
    shiftId: string | undefined,
    dto: CloseShiftDto,
  ): Promise<PresentedShift> {
    const businessId = requireBusinessId(cashier);

    const shift = await this.prisma.shiftSession.findFirst({
      where: {
        ...(shiftId
          ? { id: shiftId }
          : { cashierId: cashier.sub, status: ShiftStatus.OPEN }),
        businessId,
        ...(cashier.role === Role.CASHIER ? { cashierId: cashier.sub } : {}),
      },
      select: { id: true, startingAmount: true, status: true },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift.status !== ShiftStatus.OPEN) {
      throw new ConflictException('This shift is already closed');
    }

    const { cashSales, advancesOut } = await this.computeShiftMetrics(
      shift.id,
      businessId,
    );

    const expectedAmount = shift.startingAmount + cashSales - advancesOut;
    const variance = dto.closingAmount - expectedAmount;

    const closed = await this.prisma.shiftSession.updateMany({
      where: {
        id: shift.id,
        businessId,
        status: ShiftStatus.OPEN,
      },
      data: {
        status: ShiftStatus.CLOSED,
        closingAmount: dto.closingAmount,
        expectedAmount,
        variance,
        cashSales,
        advancesOut,
        notes: dto.notes?.trim() || null,
        closedAt: new Date(),
      },
    });

    if (closed.count === 0) {
      throw new ConflictException('This shift is already closed');
    }

    return this.prisma.shiftSession.findFirstOrThrow({
      where: { id: shift.id, businessId },
      select: shiftSelect,
    });
  }

  async addAdvance(cashier: AccessTokenPayload, dto: CreateShiftAdvanceDto) {
    const businessId = requireBusinessId(cashier);

    const activeShift = await this.prisma.shiftSession.findFirst({
      where: {
        businessId,
        cashierId: cashier.sub,
        status: ShiftStatus.OPEN,
      },
      select: { id: true, startingAmount: true },
    });

    if (!activeShift) {
      throw new ConflictException('No open shift found to withdraw cash from');
    }

    const user = await this.prisma.user?.findFirst?.({
      where: { id: cashier.sub, businessId, deletedAt: null },
      select: { monthlySalary: true },
    });

    const maxSalary = user?.monthlySalary ?? 0;
    if (maxSalary <= 0) {
      throw new BadRequestException(
        'Salary advances require a positive monthly salary configured on your account',
      );
    }

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const { start, end } = payrollPeriod(year, month);

    const executeInTx = async (tx: any) => {
      const payrollDelegate =
        tx.payrollRecord ?? (this.prisma as any).payrollRecord;
      if (payrollDelegate?.findFirst) {
        const settled = await payrollDelegate.findFirst({
          where: {
            businessId,
            cashierId: cashier.sub,
            month,
            year,
            status: 'PAID',
          },
        });
        if (settled) {
          throw new BadRequestException(
            'Payroll for the current month has already been settled',
          );
        }
      }

      let currentPending = 0;
      if (tx.employeeAdvance?.aggregate) {
        const agg = await tx.employeeAdvance.aggregate({
          where: {
            businessId,
            cashierId: cashier.sub,
            status: 'PENDING',
            deletedAt: null,
            takenAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        });
        currentPending = agg._sum?.amount ?? 0;
      } else if (tx.employeeAdvance?.findMany) {
        const existing = await tx.employeeAdvance.findMany({
          where: {
            businessId,
            cashierId: cashier.sub,
            status: 'PENDING',
            deletedAt: null,
            takenAt: { gte: start, lt: end },
          },
        });
        currentPending = Array.isArray(existing)
          ? existing.reduce((sum: number, item: any) => sum + (item.amount ?? 0), 0)
          : 0;
      }

      if (currentPending + dto.amount > maxSalary) {
        throw new BadRequestException(
          'Advance amount exceeds remaining monthly salary limit',
        );
      }

      return tx.employeeAdvance.create({
        data: {
          businessId,
          cashierId: cashier.sub,
          shiftId: activeShift.id,
          amount: dto.amount,
          reason: dto.reason.trim(),
        },
        select: {
          id: true,
          amount: true,
          reason: true,
          takenAt: true,
          status: true,
        },
      });
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction((tx) => executeInTx(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return executeInTx(this.prisma);
  }

  async list(user: AccessTokenPayload, query: ListShiftsQueryDto) {
    const scope = resolveLocationScope(user, query.locationId);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.ShiftSessionWhereInput = {
      businessId: scope.businessId,
      ...(scope.locationId ? { locationId: scope.locationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(user.role === Role.CASHIER ? { cashierId: user.sub } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.shiftSession.count({ where }),
      this.prisma.shiftSession.findMany({
        where,
        select: shiftSelect,
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private async computeShiftMetrics(shiftId: string, businessId: string) {
    const shift = this.prisma.shiftSession?.findFirst
      ? await this.prisma.shiftSession.findFirst({
          where: { id: shiftId, businessId },
          select: { openedAt: true, closedAt: true, status: true },
        })
      : null;

    const refundPromise = this.prisma.refund?.aggregate
      ? this.prisma.refund.aggregate({
          where: {
            order: {
              shiftId,
              paymentMethod: PaymentMethod.COD,
            },
            ...(shift?.closedAt ? { createdAt: { lte: shift.closedAt } } : {}),
          },
          _sum: { totalRefund: true },
        })
      : Promise.resolve({ _sum: { totalRefund: 0 } });

    const [cashOrdersAgg, advancesAgg, advanceLedger, codRefundsAgg] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: {
            shiftId,
            paymentMethod: PaymentMethod.COD,
            status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.employeeAdvance.aggregate({
          where: {
            shiftId,
            businessId,
            deletedAt: null,
          },
          _sum: { amount: true },
        }),
        this.prisma.employeeAdvance.findMany({
          where: {
            shiftId,
            businessId,
            deletedAt: null,
          },
          select: {
            id: true,
            amount: true,
            reason: true,
            takenAt: true,
            status: true,
          },
          orderBy: { takenAt: 'desc' },
        }),
        refundPromise,
      ]);

    const rawCashSales = cashOrdersAgg?._sum?.totalAmount ?? 0;
    const codRefunds = codRefundsAgg?._sum?.totalRefund ?? 0;
    const cashSales = Math.max(0, rawCashSales - codRefunds);
    const advancesOut = advancesAgg?._sum?.amount ?? 0;

    return { cashSales, advancesOut, advanceLedger };
  }

  private resolveOpenLocationId(
    actor: AccessTokenPayload,
    dto: OpenShiftDto,
  ): string {
    if (actor.role === Role.CASHIER) {
      if (!actor.locationId) {
        throw new ForbiddenException(
          'A cashier must be assigned to a location before opening a shift',
        );
      }
      return actor.locationId;
    }

    const locationId = dto.locationId ?? actor.locationId;
    if (!locationId) {
      throw new ForbiddenException('Location ID is required to open a shift');
    }

    return locationId;
  }
}
