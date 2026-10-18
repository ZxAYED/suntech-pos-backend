import { NotFoundException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { IdGeneratorService } from '../identity/id-generator.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './user.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('UserService', () => {
  const locationFindFirst = jest.fn();
  const userCreate = jest.fn();
  const userFindMany = jest.fn();
  const userFindFirst = jest.fn();
  const userUpdate = jest.fn();
  const withUniquePublicId = jest.fn();

  const prisma = {
    location: { findFirst: locationFindFirst },
    user: {
      create: userCreate,
      findMany: userFindMany,
      findFirst: userFindFirst,
      update: userUpdate,
    },
  } as unknown as PrismaService;

  const idGenerator = {
    withUniquePublicId,
  } as unknown as IdGeneratorService;

  const cloudinary = {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
  } as unknown as CloudinaryService;

  const service = new UserService(prisma, idGenerator, cloudinary);

  beforeEach(() => {
    locationFindFirst.mockReset();
    userCreate.mockReset();
    userFindMany.mockReset();
    userFindFirst.mockReset();
    userUpdate.mockReset();
    withUniquePublicId.mockReset();
  });

  describe('createCashier', () => {
    it('does not create a cashier when the location is outside the business', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.createCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          {
            fullName: 'Rafi',
            password: 'password123',
            locationId: 'other-location',
            monthlySalary: 20000,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(locationFindFirst).toHaveBeenCalledWith({
        where: {
          id: 'other-location',
          businessId: 'biz-1',
          deletedAt: null,
        },
      });
      expect(withUniquePublicId).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
    });
  });

  describe('listCashiers', () => {
    it('lists cashiers in the admin business with location and masked internal email', async () => {
      userFindMany.mockResolvedValue([
        {
          id: 'csh-1',
          publicId: 'CSH-001',
          fullName: 'Alex Rivera',
          email: 'csh-001@cashiers.suntech.internal',
          phoneNumber: '01800000000',
          role: Role.CASHIER,
          status: AccountStatus.ACTIVE,
          statusReason: null,
          businessId: 'biz-1',
          locationId: 'loc-1',
          monthlySalary: 35000,
          profileImageUrl: null,
          location: { id: 'loc-1', name: 'Uttara Branch' },
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ]);

      const result = await service.listCashiers(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        { locationId: 'loc-1', search: 'Alex' },
      );

      expect(result).toHaveLength(1);
      expect(result[0].email).toBeNull();
      expect(result[0].location).toEqual({
        id: 'loc-1',
        name: 'Uttara Branch',
      });
      expect(userFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          businessId: 'biz-1',
          role: Role.CASHIER,
          deletedAt: null,
          locationId: 'loc-1',
        }),
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateCashier', () => {
    it('updates cashier details and validates locationId in business', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        businessId: 'biz-1',
        role: Role.CASHIER,
      });
      locationFindFirst.mockResolvedValue({
        id: 'loc-new',
        businessId: 'biz-1',
      });
      userUpdate.mockResolvedValue({
        id: 'csh-1',
        publicId: 'CSH-001',
        fullName: 'Alex Rivera Updated',
        email: 'alex@custom.com',
        phoneNumber: '01811111111',
        role: Role.CASHIER,
        status: AccountStatus.ACTIVE,
        statusReason: null,
        businessId: 'biz-1',
        locationId: 'loc-new',
        monthlySalary: 40000,
        profileImageUrl: null,
        location: { id: 'loc-new', name: 'Dhanmondi Branch' },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });

      const result = await service.updateCashier(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'csh-1',
        {
          fullName: 'Alex Rivera Updated',
          phoneNumber: '01811111111',
          locationId: 'loc-new',
          monthlySalary: 40000,
        },
      );

      expect(locationFindFirst).toHaveBeenCalledWith({
        where: { id: 'loc-new', businessId: 'biz-1', deletedAt: null },
      });
      expect(result.fullName).toBe('Alex Rivera Updated');
      expect(result.location?.name).toBe('Dhanmondi Branch');
    });

    it('throws NotFoundException if cashier does not exist in business', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.updateCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'csh-unknown',
          { fullName: 'New Name' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException if new location is outside the business', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        businessId: 'biz-1',
        role: Role.CASHIER,
      });
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.updateCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'csh-1',
          { locationId: 'other-loc' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteCashier', () => {
    it('soft deletes cashier by setting deletedAt', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        businessId: 'biz-1',
        role: Role.CASHIER,
      });
      userUpdate.mockResolvedValue({
        id: 'csh-1',
        deletedAt: new Date(),
      });

      const result = await service.deleteCashier(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'csh-1',
      );

      expect(result.id).toBe('csh-1');
      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'csh-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException when cashier to delete is not found', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.deleteCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'unknown',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
