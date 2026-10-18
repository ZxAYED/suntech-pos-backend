import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { IdGeneratorService } from '../identity/id-generator.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const userCount = jest.fn();
  const userFindMany = jest.fn();
  const userFindFirst = jest.fn();
  const userFindUniqueOrThrow = jest.fn();
  const userUpdate = jest.fn();
  const assignUniquePublicId = jest.fn();

  const prisma = {
    user: {
      count: userCount,
      findMany: userFindMany,
      findFirst: userFindFirst,
      findUniqueOrThrow: userFindUniqueOrThrow,
      update: userUpdate,
    },
  } as unknown as PrismaService;

  const idGenerator = {
    assignUniquePublicId,
  } as unknown as IdGeneratorService;

  const service = new AdminService(prisma, idGenerator);

  beforeEach(() => {
    userCount.mockReset();
    userFindMany.mockReset();
    userFindFirst.mockReset();
    userFindUniqueOrThrow.mockReset();
    userUpdate.mockReset();
    assignUniquePublicId.mockReset();
  });

  describe('list', () => {
    it('lists admin users with owned business and location count', async () => {
      userCount.mockResolvedValue(1);
      userFindMany.mockResolvedValue([
        {
          id: 'admin-1',
          publicId: 'ADM-12345',
          fullName: 'John Admin',
          email: 'admin@test.com',
          phoneNumber: '01700000000',
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          statusReason: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          ownedBusiness: {
            id: 'biz-1',
            name: 'Test Retail',
            _count: { locations: 2 },
          },
        },
      ]);

      const result = await service.list({
        status: AccountStatus.ACTIVE,
        search: 'John',
        page: 1,
        limit: 10,
      });

      expect(userCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          deletedAt: null,
        }),
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].business).toEqual({
        id: 'biz-1',
        name: 'Test Retail',
        _count: { locations: 2 },
      });
    });
  });

  describe('approve', () => {
    it('approves a pending admin and assigns public id', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.PENDING_APPROVAL,
      });
      assignUniquePublicId.mockResolvedValue('ADM-NEW01');
      userFindUniqueOrThrow.mockResolvedValue({
        id: 'admin-1',
        publicId: 'ADM-NEW01',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      });

      const result = await service.approve('admin-1');

      expect(assignUniquePublicId).toHaveBeenCalledWith('admin-1');
      expect(result.publicId).toBe('ADM-NEW01');
    });

    it('throws NotFoundException if user does not exist', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(service.approve('unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException if user is not an ADMIN', async () => {
      userFindFirst.mockResolvedValue({
        id: 'cashier-1',
        role: Role.CASHIER,
        status: AccountStatus.PENDING_APPROVAL,
      });

      await expect(service.approve('cashier-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws ConflictException if user is not in PENDING_APPROVAL status', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      });

      await expect(service.approve('admin-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('updateStatus', () => {
    it('updates status to SUSPENDED with a reason', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        publicId: 'ADM-12345',
      });
      userUpdate.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.SUSPENDED,
        statusReason: 'Policy violation',
      });

      const result = await service.updateStatus('admin-1', {
        status: AccountStatus.SUSPENDED,
        statusReason: 'Policy violation',
      });

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: {
          status: AccountStatus.SUSPENDED,
          statusReason: 'Policy violation',
        },
        select: expect.any(Object),
      });
      expect(result.status).toBe(AccountStatus.SUSPENDED);
    });

    it('assigns publicId if activating an admin without publicId', async () => {
      userFindFirst.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.PENDING_APPROVAL,
        publicId: null,
      });
      assignUniquePublicId.mockResolvedValue('ADM-88888');
      userUpdate.mockResolvedValue({
        id: 'admin-1',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      });

      await service.updateStatus('admin-1', {
        status: AccountStatus.ACTIVE,
      });

      expect(assignUniquePublicId).toHaveBeenCalledWith('admin-1');
      expect(userUpdate).toHaveBeenCalled();
    });

    it('throws NotFoundException if admin not found', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus('unknown', { status: AccountStatus.ACTIVE }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
