import { randomInt } from 'crypto';

const INVOICE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVOICE_LENGTH = 4;

export function createInvoiceNumber(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  let suffix = '';
  for (let index = 0; index < INVOICE_LENGTH; index += 1) {
    suffix += INVOICE_ALPHABET[randomInt(INVOICE_ALPHABET.length)];
  }

  return `INV-${year}${month}${day}-${suffix}`;
}
