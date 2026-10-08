export type RefundStatus = 'PARTIALLY_REFUNDED' | 'REFUNDED';

export function refundStatus(
  items: Array<{ quantity: number; refunded: number }>,
): RefundStatus | null {
  const refundedUnits = items.reduce((total, item) => total + item.refunded, 0);

  if (refundedUnits === 0) {
    return null;
  }

  const fullyRefunded = items.every((item) => item.refunded >= item.quantity);

  return fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
