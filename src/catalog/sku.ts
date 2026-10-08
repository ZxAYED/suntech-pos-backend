import { randomInt } from 'crypto';

const SKU_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SKU_LENGTH = 6;

export function createSku(): string {
  let body = '';

  for (let index = 0; index < SKU_LENGTH; index += 1) {
    body += SKU_ALPHABET[randomInt(SKU_ALPHABET.length)];
  }

  return `PRD-${body}`;
}
