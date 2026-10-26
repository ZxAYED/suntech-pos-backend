import { ConflictException } from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  ShiftStatus,
  StockTransactionType,
} from '@prisma/client';
import { RefundService } from './refund.service';

describe('RefundService', () => {
  const orderFindFirst = jest.fn();
  const variantUpdateMany = jest.fn();
  const stockCreate = jest.fn();
  const refundCreate = jest.fn();
  const shiftFindFirst = jest.fn();
  const shiftUpdateMany = jest.fn();
  const orderUpdate = jest.fn();
  const tx = {
    order: { findFirst: orderFindFirst, update: orderUpdate },
    variant: { updateMany: variantUpdateMany },
    stockTransaction: { create: stockCreate },
    refund: { create: refundCreate },
    shiftSession: { findFirst: shiftFindFirst, updateMany: shiftUpdateMany },
  };
  const service = new RefundService({} as never);

  beforeEach(() => {
    orderFindFirst.mockReset();
    variantUpdateMany.mockReset();
    stockCreate.mockReset();
    refundCreate.mockReset();
    shiftFindFirst.mockReset();
    shiftUpdateMany.mockReset();
    orderUpdate.mockReset();
    variantUpdateMany.mockResolvedValue({ count: 1 });
    refundCreate.mockImplementation(
      ({ data }: { data: { totalRefund: number } }) =>
        Promise.resolve({
          id: 'refund-1',
          orderId: 'order-1',
          totalRefund: data.totalRefund,
          items: [],
        }),
    );
  });

  it("routes a late cash refund only to the processing cashier's open shift", async () => {
    orderFindFirst.mockResolvedValue({
      id: 'order-1',
      locationId: 'loc-1',
      shiftId: 'closed-shift',
      paymentMethod: PaymentMethod.COD,
      receiptNumber: 'RCPT-LATE',
      lines: [
        {
          id: 'line-1',
          variantId: null,
          unitPrice: 500,
          quantity: 1,
          refundItems: [],
        },
      ],
    });
    shiftFindFirst
      .mockResolvedValueOnce({ id: 'closed-shift', status: ShiftStatus.CLOSED })
      .mockResolvedValueOnce({ id: 'current-shift' });

    await service.createWithin(
      tx as unknown as Prisma.TransactionClient,
      'cashier-2',
      'biz-1',
      'order-1',
      { items: [{ orderItemId: 'line-1', quantity: 1 }] },
      'loc-1',
    );

    expect(shiftFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        locationId: 'loc-1',
        businessId: 'biz-1',
        cashierId: 'cashier-2',
        status: ShiftStatus.OPEN,
      },
      select: { id: true },
    });
    expect(shiftUpdateMany).toHaveBeenCalledWith({
      where: { id: 'current-shift', status: ShiftStatus.OPEN },
      data: { cashCollected: { decrement: 500 } },
    });
  });

  it('rejects a refund larger than the quantity still available', async () => {
    orderFindFirst.mockResolvedValue({
      id: 'order-1',
      receiptNumber: 'RCPT-TEST',
      items: [
        {
          id: 'line-1',
          variantId: 'variant-1',
          price: 1000,
          quantity: 2,
          refundItems: [{ quantity: 1 }],
        },
      ],
    });

    await expect(
      service.createWithin(
        tx as unknown as Prisma.TransactionClient,
        'admin-1',
        'biz-1',
        'order-1',
        { items: [{ orderItemId: 'line-1', quantity: 2 }] },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(variantUpdateMany).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('restores the remaining units at the stored price', async () => {
    orderFindFirst.mockResolvedValue({
      id: 'order-1',
      receiptNumber: 'RCPT-TEST',
      items: [
        {
          id: 'line-1',
          variantId: 'variant-1',
          price: 1000,
          quantity: 2,
          refundItems: [{ quantity: 1 }],
        },
      ],
    });

    const refund = await service.createWithin(
      tx as unknown as Prisma.TransactionClient,
      'admin-1',
      'biz-1',
      'order-1',
      { reason: 'Wrong size', items: [{ orderItemId: 'line-1', quantity: 1 }] },
    );

    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1', cashier: { businessId: 'biz-1' } },
      }),
    );
    expect(variantUpdateMany).toHaveBeenCalledWith({
      where: { id: 'variant-1', businessId: 'biz-1' },
      data: { stock: { increment: 1 } },
    });
    expect(stockCreate).toHaveBeenCalledWith({
      data: {
        variantId: 'variant-1',
        locationId: null,
        type: StockTransactionType.REFUND,
        quantity: 1,
        notes: 'RCPT-TEST',
      },
    });
    expect(refund.totalRefund).toBe(1000);
    expect(refund.refundStatus).toBe('REFUNDED');
  });

  it('allows a cashier to process a refund with processedById set to cashier sub', async () => {
    orderFindFirst.mockResolvedValue({
      id: 'order-1',
      receiptNumber: 'RCPT-CASHIER',
      items: [
        {
          id: 'line-1',
          variantId: 'variant-1',
          price: 1500,
          quantity: 1,
          refundItems: [],
        },
      ],
    });

    const refund = await service.createWithin(
      tx as unknown as Prisma.TransactionClient,
      'cashier-1',
      'biz-1',
      'order-1',
      {
        reason: 'Customer returned item',
        items: [{ orderItemId: 'line-1', quantity: 1 }],
      },
      'loc-1',
    );

    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-1',
          cashier: { businessId: 'biz-1' },
          locationId: 'loc-1',
        },
      }),
    );

    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          processedById: 'cashier-1',
          totalRefund: 1500,
          reason: 'Customer returned item',
        }),
      }),
    );
    expect(refund.totalRefund).toBe(1500);
  });
});
