import { randomInt } from 'crypto';

const RECEIPT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECEIPT_LENGTH = 8;

export function createReceiptNumber(): string {
  let body = '';

  for (let index = 0; index < RECEIPT_LENGTH; index += 1) {
    body += RECEIPT_ALPHABET[randomInt(RECEIPT_ALPHABET.length)];
  }

  return `RCPT-${body}`;
}
