import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PUBLIC_ID_LENGTH = 5;
const MAX_ATTEMPTS = 3;

@Injectable()
export class IdGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  createPublicId(prefix: 'ADM' | 'CSH'): string {
    let body = '';

    for (let index = 0; index < PUBLIC_ID_LENGTH; index += 1) {
      body += PUBLIC_ID_ALPHABET[randomInt(PUBLIC_ID_ALPHABET.length)];
    }

    return `${prefix}-${body}`;
  }

  /**
   * Mints a public id and activates the pending account in one write.
   * Unique collisions (P2002) are retried up to three times.
   * Returns null when the account is no longer awaiting approval.
   */
  async assignUniquePublicId(userId: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const publicId = this.createPublicId('ADM');

      try {
        const result = await this.prisma.user.updateMany({
          where: {
            id: userId,
            publicId: null,
            deletedAt: null,
          },
          data: {
            publicId,
            status: AccountStatus.ACTIVE,
          },
        });

        if (result.count === 0) {
          return null;
        }

        return publicId;
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < MAX_ATTEMPTS) {
          continue;
        }

        if (isUniqueConstraintError(error)) {
          throw new InternalServerErrorException(
            'Unable to mint a unique public id',
          );
        }

        throw error;
      }
    }

    throw new InternalServerErrorException('Unable to mint a unique public id');
  }

  /**
   * Runs a write with a freshly minted public id.
   * Retries only when PostgreSQL rejects that public id (P2002).
   */
  async withUniquePublicId<T>(
    prefix: 'ADM' | 'CSH',
    write: (publicId: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const publicId = this.createPublicId(prefix);

      try {
        return await write(publicId);
      } catch (error) {
        if (
          isUniqueConstraintError(error) &&
          this.targetsPublicId(error) &&
          attempt < MAX_ATTEMPTS
        ) {
          continue;
        }

        if (isUniqueConstraintError(error) && this.targetsPublicId(error)) {
          throw new InternalServerErrorException(
            'Unable to mint a unique public id',
          );
        }

        throw error;
      }
    }

    throw new InternalServerErrorException('Unable to mint a unique public id');
  }

  private targetsPublicId(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target : [target];

    return fields.some(
      (field) =>
        typeof field === 'string' && field.toLowerCase().includes('publicid'),
    );
  }
}
