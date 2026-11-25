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
import {
  getDhakaDayRange,
  getDhakaStartOfDay,
  isShiftOverdue,
  parseDhakaDateString,
} from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CloseShiftDto } from './dto/close-shift.dto';
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
  autoCloseReason: true,
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
  autoClosedPreviousShiftIds?: string[];
  isOverdue?: boolean;
  closingCashNotProvided?: boolean;
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
  return dateObj.getTime() < getDhakaStartOfDay(now).getTime();
}

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async open(
    actor: AccessTokenPayload,
    dto: OpenShiftDto,
  ): Promise<PresentedShift> {
    const businessId =
      actor.role === Role.ADMIN
        ? requireBusinessId(actor, dto.businessId)
        : requireBusinessId(actor);
    const locationId = this.resolveOpenLocationId(actor, dto);
    const operationTime = new Date();
    const { start: startOfToday, nextStart: nextDayStart } =
      getDhakaDayRange(operationTime);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const location = await tx.location.findFirst({
            where: { id: locationId, businessId, deletedAt: null },
            select: { id: true },
          });

          if (!location) {
            const anyLoc = await tx.location.findFirst({
              where: { id: locationId, deletedAt: null },
              select: { id: true, businessId: true },
            });
            if (
              anyLoc &&
              anyLoc.businessId &&
              anyLoc.businessId !== businessId
            ) {
              throw new BadRequestException(
                'Location does not belong to the specified business',
              );
            }
            if (actor.role === Role.ADMIN) {
              throw new NotFoundException('Branch location not found');
            }
            throw new ForbiddenException(
              'Your location is no longer available',
            );
          }

          const sameDayShift = await tx.shiftSession.findFirst({
            where: {
              cashierId: actor.sub,
              openedAt: {
                gte: startOfToday,
                lt: nextDayStart,
              },
            },
            select: { id: true, status: true, openedAt: true },
          });

          if (sameDayShift) {
            throw new ConflictException(ALREADY_OPEN_TODAY);
          }

          const olderOpenShifts = await tx.shiftSession.findMany({
            where: {
              businessId,
              cashierId: actor.sub,
              status: ShiftStatus.OPEN,
              openedAt: { lt: startOfToday },
            },
            select: { id: true, startingAmount: true },
          });

          for (const oldShift of olderOpenShifts) {
            const refundPromise = tx.refund?.aggregate
              ? tx.refund.aggregate({
                  where: {
                    payoutShiftId: oldShift.id,
                    order: {
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
                    shiftId: oldShift.id,
                    paymentMethod: PaymentMethod.COD,
                    status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
                  },
                  _sum: { totalAmount: true },
                }),
                tx.employeeAdvance.aggregate({
                  where: {
                    shiftId: oldShift.id,
                    businessId,
                    deletedAt: null,
                  },
                  _sum: { amount: true },
                }),
                refundPromise,
              ]);

            const rawCashSales = cashOrdersAgg?._sum?.totalAmount ?? 0;
            const codRefunds = codRefundsAgg?._sum?.totalRefund ?? 0;
            const cashSales = rawCashSales - codRefunds;
            const advancesOut = advancesAgg?._sum?.amount ?? 0;
            const expectedAmount =
              (oldShift.startingAmount ?? 0) + cashSales - advancesOut;

            await tx.shiftSession.update({
              where: { id: oldShift.id },
              data: {
                status: ShiftStatus.CLOSED,
                closingAmount: null,
                expectedAmount,
                variance: null,
                cashSales,
                advancesOut,
                autoCloseReason: 'AUTO_CLOSED_PRIOR_DAY_UNCOUNTED',
                closedAt: operationTime,
              },
            });
          }

          const autoClosedPreviousShiftIds = olderOpenShifts.map((s) => s.id);
          const autoClosedPreviousShiftId =
            autoClosedPreviousShiftIds.length === 1
              ? autoClosedPreviousShiftIds[0]
              : undefined;

          const created = await tx.shiftSession.create({
            data: {
              businessId,
              locationId,
              cashierId: actor.sub,
              startingAmount: dto.startingAmount,
              status: ShiftStatus.OPEN,
              openedAt: operationTime,
            },
            select: shiftSelect,
          });

          return {
            ...created,
            isOverdue: false,
            closingCashNotProvided: false,
            ...(autoClosedPreviousShiftId ? { autoClosedPreviousShiftId } : {}),
            ...(autoClosedPreviousShiftIds.length > 0
              ? { autoClosedPreviousShiftIds }
              : {}),
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
    actor: AccessTokenPayload,
    locationId?: string,
    businessIdQuery?: string,
  ): Promise<ActiveShiftDetails> {
    const effectiveLocationId =
      locationId?.trim() ||
      (actor.role === Role.CASHIER ? actor.locationId : undefined);

    let businessId = requireBusinessId(actor, businessIdQuery);
    if (effectiveLocationId && this.prisma.location) {
      const loc = this.prisma.location.findFirst
        ? await this.prisma.location.findFirst({
            where: { id: effectiveLocationId, deletedAt: null },
            select: { id: true, businessId: true },
          })
        : await this.prisma.location.findUnique({
            where: { id: effectiveLocationId },
            select: { id: true, businessId: true },
          });

      if (!loc) {
        throw new NotFoundException('Location not found');
      }

      if (actor.role === Role.ADMIN) {
        const owned =
          actor.businessIds && actor.businessIds.length > 0
            ? actor.businessIds
            : [businessId];
        if (!owned.includes(loc.businessId)) {
          throw new ForbiddenException(
            'Location does not belong to your business',
          );
        }
      }

      if (loc.businessId && loc.businessId !== businessId) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
    }

    const shift = await this.prisma.shiftSession.findFirst({
      where: {
        businessId,
        ...(effectiveLocationId ? { locationId: effectiveLocationId } : {}),
        ...(actor.role === Role.CASHIER ? { cashierId: actor.sub } : {}),
        status: ShiftStatus.OPEN,
      },
      orderBy: { openedAt: 'desc' },
      select: shiftSelect,
    });

    if (!shift) {
      throw new NotFoundException('No active open shift found');
    }

    const { cashSales, advancesOut, advanceLedger } =
      await this.computeShiftMetrics(shift.id, businessId);

    const expectedCash = shift.startingAmount + cashSales - advancesOut;

    return {
      ...shift,
      isOverdue: isShiftOverdue(shift.openedAt, shift.status),
      closingCashNotProvided: false,
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
    const businessId =
      cashier.role === Role.ADMIN
        ? requireBusinessId(cashier, dto.businessId)
        : requireBusinessId(cashier);
    const operationTime = new Date();

    const executeClose = async (tx: Prisma.TransactionClient) => {
      const shift = await tx.shiftSession.findFirst({
        where: {
          ...(shiftId
            ? { id: shiftId }
            : { cashierId: cashier.sub, status: ShiftStatus.OPEN }),
          businessId,
          ...(cashier.role === Role.CASHIER ? { cashierId: cashier.sub } : {}),
        },
        select: { id: true, startingAmount: true, status: true, notes: true },
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
        tx,
      );

      const expectedAmount = shift.startingAmount + cashSales - advancesOut;
      const variance = dto.closingAmount - expectedAmount;

      const closingNotes = dto.notes?.trim()
        ? shift.notes
          ? `${shift.notes}\n[Closing Note]: ${dto.notes.trim()}`
          : dto.notes.trim()
        : shift.notes ?? null;

      const closed = await tx.shiftSession.updateMany({
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
          notes: closingNotes,
          closedAt: operationTime,
        },
      });

      if (closed.count === 0) {
        throw new ConflictException('This shift is already closed');
      }

      const closedRecord = await tx.shiftSession.findFirstOrThrow({
        where: { id: shift.id, businessId },
        select: shiftSelect,
      });

      return {
        ...closedRecord,
        isOverdue: false,
        closingCashNotProvided: false,
      };
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction(executeClose, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return executeClose(this.prisma as unknown as Prisma.TransactionClient);
  }

  async list(user: AccessTokenPayload, query: ListShiftsQueryDto) {
    const scope = resolveLocationScope(
      user,
      query.locationId,
      query.businessId,
    );

    if (scope.locationId && this.prisma.location?.findFirst) {
      const loc = await this.prisma.location.findFirst({
        where: { id: scope.locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (!loc) {
        throw new NotFoundException('Location not found');
      }
      if (loc.businessId && loc.businessId !== scope.businessId) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
    }

    let fromDateStart: Date | null = null;
    let toDateNextStart: Date | null = null;

    if (query.fromDate) {
      fromDateStart = parseDhakaDateString(query.fromDate);
      if (!fromDateStart) {
        throw new BadRequestException(
          'Invalid fromDate format. Expected YYYY-MM-DD',
        );
      }
    }

    if (query.toDate) {
      const toDateStart = parseDhakaDateString(query.toDate);
      if (!toDateStart) {
        throw new BadRequestException(
          'Invalid toDate format. Expected YYYY-MM-DD',
        );
      }
      toDateNextStart = new Date(toDateStart.getTime() + 24 * 60 * 60 * 1000);
    }

    if (fromDateStart && toDateNextStart) {
      if (fromDateStart.getTime() >= toDateNextStart.getTime()) {
        throw new BadRequestException('fromDate cannot be after toDate');
      }
    }

    let targetCashierId: string | undefined = undefined;
    if (user.role === Role.CASHIER) {
      if (query.cashierId && query.cashierId !== user.sub) {
        throw new ForbiddenException('Cashiers may only view their own shifts');
      }
      targetCashierId = user.sub;
    } else if (query.cashierId) {
      const cashierUser = await this.prisma.user.findFirst({
        where: {
          id: query.cashierId,
          businessId: scope.businessId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!cashierUser) {
        throw new BadRequestException(
          'Cashier does not belong to the specified business',
        );
      }
      targetCashierId = query.cashierId;
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.ShiftSessionWhereInput = {
      businessId: scope.businessId,
      ...(scope.locationId ? { locationId: scope.locationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(targetCashierId ? { cashierId: targetCashierId } : {}),
      ...(fromDateStart || toDateNextStart
        ? {
            openedAt: {
              ...(fromDateStart ? { gte: fromDateStart } : {}),
              ...(toDateNextStart ? { lt: toDateNextStart } : {}),
            },
          }
        : {}),
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

    const formattedData: PresentedShift[] = data.map((shift) => ({
      ...shift,
      isOverdue: isShiftOverdue(shift.openedAt, shift.status),
      closingCashNotProvided:
        shift.status === ShiftStatus.CLOSED && shift.closingAmount === null,
    }));

    return {
      data: formattedData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private async computeShiftMetrics(
    shiftId: string,
    businessId: string,
    txClient?: Prisma.TransactionClient,
  ) {
    const client = (txClient ?? this.prisma) as any;
    const shift = client.shiftSession?.findFirst
      ? await client.shiftSession.findFirst({
          where: { id: shiftId, businessId },
          select: { openedAt: true, closedAt: true, status: true },
        })
      : null;

    const refundPromise = client.refund?.aggregate
      ? client.refund.aggregate({
          where: {
            payoutShiftId: shiftId,
            order: {
              paymentMethod: PaymentMethod.COD,
            },
            ...(shift?.closedAt ? { createdAt: { lte: shift.closedAt } } : {}),
          },
          _sum: { totalRefund: true },
        })
      : Promise.resolve({ _sum: { totalRefund: 0 } });

    const [cashOrdersAgg, advancesAgg, advanceLedger, codRefundsAgg] =
      await Promise.all([
        client.order.aggregate({
          where: {
            shiftId,
            paymentMethod: PaymentMethod.COD,
            status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
          },
          _sum: { totalAmount: true },
        }),
        client.employeeAdvance.aggregate({
          where: {
            shiftId,
            businessId,
            deletedAt: null,
          },
          _sum: { amount: true },
        }),
        client.employeeAdvance?.findMany
          ? client.employeeAdvance.findMany({
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
            })
          : Promise.resolve([]),
        refundPromise,
      ]);

    const rawCashSales = cashOrdersAgg?._sum?.totalAmount ?? 0;
    const codRefunds = codRefundsAgg?._sum?.totalRefund ?? 0;
    const cashSales = rawCashSales - codRefunds;
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

    const locationId = dto.locationId?.trim() || actor.locationId;
    if (!locationId) {
      throw new BadRequestException('locationId is required to open a shift');
    }

    return locationId;
  }
}
