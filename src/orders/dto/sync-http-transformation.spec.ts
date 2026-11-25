import { ValidationPipe } from '@nestjs/common';
import { OrderType, PaymentMethod } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncOrderItemDto, SyncOrdersDto } from './sync-orders.dto';
import { SyncV2OrderDto, SyncV2OrdersDto } from './sync-v2.dto';

const original = {
  clientOrderId: '4fa2bf6c-6cf0-4dd2-b9ed-0ef612d23598',
  occurredAt: '2026-11-24T10:00:00+06:00',
  orderType: OrderType.CATALOG,
  shiftId: null,
  paymentMethod: PaymentMethod.COD,
  tenderedAmount: 100,
  lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 100 }],
};
const scope = { deviceId: 'till-1', businessId: 'biz-1', locationId: 'loc-1' };
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe('actual global HTTP validation before sync services', () => {
  it('keeps a v1 event as an object instead of converting it to an empty array', async () => {
    const dto = await pipe.transform(
      { ...scope, orders: [original] },
      { type: 'body', metatype: SyncOrdersDto },
    );
    expect(dto.orders[0]).toEqual(original);
    expect(
      await validate(plainToInstance(SyncOrderItemDto, dto.orders[0]), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
  });

  it('keeps the original v2 fields through the same global pipe used by Nest HTTP', async () => {
    const event = {
      ...original,
      userId: 'cashier-1',
      pricePolicy: 'CURRENT_PRICE',
      grantToken: 'original.signed.grant',
    };
    const dto = await pipe.transform(
      { ...scope, orders: [event] },
      { type: 'body', metatype: SyncV2OrdersDto },
    );
    expect(dto.orders[0]).toEqual(event);
    expect(
      await validate(plainToInstance(SyncV2OrderDto, dto.orders[0]), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
  });

  it('does not move per-item validation into batch validation and reject all good items', async () => {
    const good = {
      ...original,
      userId: 'cashier-1',
      pricePolicy: 'CURRENT_PRICE',
      grantToken: 'original.signed.grant',
    };
    const bad = { ...good, tenderedAmount: -1 };
    const dto = await pipe.transform(
      { ...scope, orders: [good, bad] },
      { type: 'body', metatype: SyncV2OrdersDto },
    );
    expect(dto.orders).toHaveLength(2);
    expect(
      await validate(plainToInstance(SyncV2OrderDto, dto.orders[0]), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
    expect(
      (
        await validate(plainToInstance(SyncV2OrderDto, dto.orders[1]), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
