import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdGeneratorService } from './id-generator.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IdGeneratorService', () => {
  const updateMany = jest.fn();
  const userFindFirst = jest.fn();
  const queryRawUnsafe = jest.fn();
  const executeRawUnsafe = jest.fn();

  const prisma = {
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
    user: {
      updateMany,
      findFirst: userFindFirst,
    },
  } as unknown as PrismaService;

  const service = new IdGeneratorService(prisma);

  const uniqueError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['publicId'] } },
  );

  beforeEach(() => {
    updateMany.mockReset();
    userFindFirst.mockReset();
    queryRawUnsafe.mockReset();
    executeRawUnsafe.mockReset();
  });

  describe('generateCashierPublicId', () => {
    it('generates a sequential cashier public ID using database sequence', async () => {
      queryRawUnsafe.mockResolvedValueOnce([{ nextval: 10001 }]);
      userFindFirst.mockResolvedValueOnce(null);

      const cashierId = await service.generateCashierPublicId();

      expect(cashierId).toBe('CSH-10001');
      expect(queryRawUnsafe).toHaveBeenCalledWith(
        "SELECT nextval('cashier_public_id_seq') AS nextval;",
      );
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { publicId: 'CSH-10001' },
        select: { id: true },
      });
    });

    it('advances sequence if candidate collides with pre-existing user', async () => {
      queryRawUnsafe
        .mockResolvedValueOnce([{ nextval: 10001 }])
        .mockResolvedValueOnce([{ nextval: 10002 }]);
      userFindFirst
        .mockResolvedValueOnce({ id: 'existing-csh' })
        .mockResolvedValueOnce(null);

      const cashierId = await service.generateCashierPublicId();

      expect(cashierId).toBe('CSH-10002');
      expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully when sequence query throws', async () => {
      queryRawUnsafe.mockRejectedValue(new Error('no sequence'));
      executeRawUnsafe.mockRejectedValue(new Error('permission denied'));
      userFindFirst
        .mockResolvedValueOnce({ publicId: 'CSH-10005' })
        .mockResolvedValueOnce(null);

      const cashierId = await service.generateCashierPublicId();

      expect(cashierId).toBe('CSH-10006');
    });
  });

  describe('withZeroCollisionCashierId', () => {
    it('executes write callback with generated publicId', async () => {
      queryRawUnsafe.mockResolvedValueOnce([{ nextval: 10003 }]);
      userFindFirst.mockResolvedValueOnce(null);

      const writeCallback = jest.fn().mockResolvedValue({ id: 'csh-new' });
      const result = await service.withZeroCollisionCashierId(writeCallback);

      expect(result).toEqual({ id: 'csh-new' });
      expect(writeCallback).toHaveBeenCalledWith('CSH-10003');
    });

    it('retries write callback if concurrent P2002 collision occurs', async () => {
      queryRawUnsafe
        .mockResolvedValueOnce([{ nextval: 10003 }])
        .mockResolvedValueOnce([{ nextval: 10004 }]);
      userFindFirst.mockResolvedValue(null);

      const writeCallback = jest
        .fn()
        .mockRejectedValueOnce(uniqueError)
        .mockResolvedValueOnce({ id: 'csh-retried' });

      const result = await service.withZeroCollisionCashierId(writeCallback);

      expect(result).toEqual({ id: 'csh-retried' });
      expect(writeCallback).toHaveBeenCalledTimes(2);
      expect(writeCallback).toHaveBeenNthCalledWith(1, 'CSH-10003');
      expect(writeCallback).toHaveBeenNthCalledWith(2, 'CSH-10004');
    });
  });

  describe('createPublicId', () => {
    it('builds a zero-padded admin public id without ambiguous characters', () => {
      const publicId = service.createPublicId('ADM');

      expect(publicId).toMatch(/^ADM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    });
  });

  describe('assignUniquePublicId', () => {
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

      await expect(
        service.assignUniquePublicId('user-1'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
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
});
