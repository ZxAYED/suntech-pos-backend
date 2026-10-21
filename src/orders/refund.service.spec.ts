import { ConflictException } from '@nestjs/common';
import { Prisma, StockTransactionType } from '@prisma/client';
import { RefundService } from './refund.service';

describe('RefundService', () => {
  const orderFindFirst = jest.fn();
  const variantUpdateMany = jest.fn();
  const stockCreate = jest.fn();
  const refundCreate = jest.fn();
  const tx = {
    order: { findFirst: orderFindFirst },
    variant: { updateMany: variantUpdateMany },
    stockTransaction: { create: stockCreate },
    refund: { create: refundCreate },
  };
  const service = new RefundService({} as never);

  beforeEach(() => {
    orderFindFirst.mockReset();
    variantUpdateMany.mockReset();
    stockCreate.mockReset();
    refundCreate.mockReset();
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
});
