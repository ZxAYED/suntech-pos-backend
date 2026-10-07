import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdGeneratorService } from './id-generator.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IdGeneratorService', () => {
  const updateMany = jest.fn();
  const prisma = { user: { updateMany } } as unknown as PrismaService;
  const service = new IdGeneratorService(prisma);

  const uniqueError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'test' },
  );

  beforeEach(() => {
    updateMany.mockReset();
  });

  it('builds a zero-padded admin public id without ambiguous characters', () => {
    const publicId = service.createPublicId('ADM');

    expect(publicId).toMatch(/^ADM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it('retries when Prisma reports a unique public id collision', async () => {
    updateMany
      .mockRejectedValueOnce(uniqueError)
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({ count: 1 });

    const publicId = await service.assignUniquePublicId('user-1');

    expect(publicId).toMatch(/^ADM-/);
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('stops after three unique collisions', async () => {
    updateMany.mockRejectedValue(uniqueError);

    await expect(service.assignUniquePublicId('user-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('does not retry unrelated database errors', async () => {
    updateMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.assignUniquePublicId('user-1')).rejects.toThrow(
      'database unavailable',
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('returns null when the account is no longer pending', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.assignUniquePublicId('user-1')).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
