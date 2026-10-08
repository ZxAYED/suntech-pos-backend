import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShiftStatus } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';

const shiftSelect = {
  id: true,
  businessId: true,
  locationId: true,
  cashierId: true,
  startingAmount: true,
  closingAmount: true,
  status: true,
  openedAt: true,
  closedAt: true,
} satisfies Prisma.ShiftSessionSelect;

export type PresentedShift = Prisma.ShiftSessionGetPayload<{
  select: typeof shiftSelect;
}>;

const ALREADY_OPEN = 'You already have an open shift';

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async open(
    cashier: AccessTokenPayload,
    dto: OpenShiftDto,
  ): Promise<PresentedShift> {
    const businessId = requireBusinessId(cashier);
    const locationId = this.requireLocationId(cashier);

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
              cashierId: cashier.sub,
              status: ShiftStatus.OPEN,
            },
            select: { id: true },
          });

          if (openShift) {
            throw new ConflictException(ALREADY_OPEN);
          }

          return tx.shiftSession.create({
            data: {
              businessId,
              locationId,
              cashierId: cashier.sub,
              startingAmount: dto.startingAmount,
              status: ShiftStatus.OPEN,
            },
            select: shiftSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(ALREADY_OPEN);
      }

      throw error;
    }
  }

  async close(
    cashier: AccessTokenPayload,
    shiftId: string,
    dto: CloseShiftDto,
  ): Promise<PresentedShift> {
    const businessId = requireBusinessId(cashier);
    const shift = await this.prisma.shiftSession.findFirst({
      where: {
        id: shiftId,
        businessId,
        cashierId: cashier.sub,
      },
      select: { id: true, status: true },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift.status !== ShiftStatus.OPEN) {
      throw new ConflictException('This shift is already closed');
    }

    const closed = await this.prisma.shiftSession.updateMany({
      where: {
        id: shift.id,
        businessId,
        cashierId: cashier.sub,
        status: ShiftStatus.OPEN,
      },
      data: {
        status: ShiftStatus.CLOSED,
        closingAmount: dto.closingAmount,
        closedAt: new Date(),
      },
    });

    if (closed.count === 0) {
      throw new ConflictException('This shift is already closed');
    }

    return this.prisma.shiftSession.findFirstOrThrow({
      where: { id: shift.id, businessId, cashierId: cashier.sub },
      select: shiftSelect,
    });
  }

  private requireLocationId(cashier: AccessTokenPayload): string {
    if (!cashier.locationId) {
      throw new ForbiddenException(
        'A cashier must be assigned to a location before opening a shift',
      );
    }

    return cashier.locationId;
  }
}
