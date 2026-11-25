import { BadRequestException } from '@nestjs/common';

export const INT_MAX = 2_147_483_647;

export function assertTender(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > INT_MAX) {
    throw new BadRequestException(
      'Tendered amount must be whole BDT between 0 and 2147483647',
    );
  }
}

export function lineTotal(price: number, quantity: number): number {
  if (
    !Number.isSafeInteger(price) ||
    price < 0 ||
    price > INT_MAX ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > INT_MAX
  ) {
    throw new BadRequestException('Invalid price or quantity');
  }

  if (price > Math.floor(INT_MAX / quantity)) {
    throw new BadRequestException('Line total is too large');
  }

  return price * quantity;
}

export function sumMoney(amounts: number[]): number {
  let total = 0;

  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > INT_MAX) {
      throw new BadRequestException('Invalid monetary amount');
    }

    if (amount > INT_MAX - total) {
      throw new BadRequestException('Order total is too large');
    }

    total += amount;
  }

  return total;
}
