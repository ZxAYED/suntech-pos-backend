import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Role, ShiftStatus } from '@prisma/client';
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
  const userUpdateMany = jest.fn();
  const shiftSessionFindFirst = jest.fn();
  const withUniquePublicId = jest.fn();

  const prisma = {
    location: { findFirst: locationFindFirst },
    shiftSession: { findFirst: shiftSessionFindFirst },
    user: {
      create: userCreate,
      findMany: userFindMany,
      findFirst: userFindFirst,
      update: userUpdate,
      updateMany: userUpdateMany,
    },
  } as unknown as PrismaService;

  const idGenerator = {
    withUniquePublicId,
    withZeroCollisionCashierId: withUniquePublicId,
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
    shiftSessionFindFirst.mockReset();
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

    it('throws ConflictException when cashier has an active open shift during branch reassignment', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        businessId: 'biz-1',
        locationId: 'loc-1',
        role: Role.CASHIER,
      });
      locationFindFirst.mockResolvedValue({
        id: 'loc-2',
        businessId: 'biz-1',
      });
      shiftSessionFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: ShiftStatus.OPEN,
      });

      await expect(
        service.updateCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'csh-1',
          { locationId: 'loc-2' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hashes and updates cashier password when provided by admin', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        businessId: 'biz-1',
        role: Role.CASHIER,
      });
      userUpdate.mockResolvedValue({
        id: 'csh-1',
        fullName: 'Alex Rivera',
        email: 'alex@example.com',
      });

      await service.updateCashier(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'csh-1',
        { password: 'NewSecurePassword123' },
      );

      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'csh-1' },
          data: expect.objectContaining({
            password: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('deleteCashier', () => {
    it('soft deletes cashier by setting deletedAt and unique suffixes', async () => {
      shiftSessionFindFirst.mockResolvedValue(null);
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        email: 'csh@store.com',
        publicId: 'CSH-001',
        phoneNumber: '01711111111',
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
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'csh-1' },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: AccountStatus.SUSPENDED,
            email: expect.stringMatching(/^csh@store\.com__del_\d+$/),
            publicId: expect.stringMatching(/^CSH-001__del_\d+$/),
            phoneNumber: expect.stringMatching(/^01711111111__del_\d+$/),
          }),
        }),
      );
    });

    it('throws ConflictException when cashier has an active open shift', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-1',
        email: 'csh@store.com',
        businessId: 'biz-1',
        role: Role.CASHIER,
      });
      shiftSessionFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: ShiftStatus.OPEN,
      });

      await expect(
        service.deleteCashier(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'csh-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
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

  describe('updateStatus', () => {
    it('throws BadRequestException when admin attempts to suspend their own account', async () => {
      await expect(
        service.updateStatus(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'admin-1',
          { status: AccountStatus.SUSPENDED },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when suspending a staff member with an active open shift', async () => {
      shiftSessionFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: ShiftStatus.OPEN,
      });

      await expect(
        service.updateStatus(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'staff-1',
          { status: AccountStatus.SUSPENDED },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('Multi-business Admin Cashier Management', () => {
    it('creates a cashier under a secondary business owned by the admin', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-biz2-1',
        businessId: 'biz-2',
        deletedAt: null,
      });
      withUniquePublicId.mockImplementation(async (callback) =>
        callback('CSH-BIZ2-001'),
      );
      userCreate.mockResolvedValue({
        id: 'user-csh-biz2',
        fullName: 'Kamal Hasan',
        email: 'kamal@biz2.com',
        role: Role.CASHIER,
        businessId: 'biz-2',
        locationId: 'loc-biz2-1',
      });

      const admin = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1', 'biz-2'],
      };

      const result = await service.createCashier(admin, {
        businessId: 'biz-2',
        fullName: 'Kamal Hasan',
        email: 'kamal@biz2.com',
        password: 'password123',
        locationId: 'loc-biz2-1',
        monthlySalary: 25000,
      });

      expect(locationFindFirst).toHaveBeenCalledWith({
        where: {
          id: 'loc-biz2-1',
          businessId: 'biz-2',
          deletedAt: null,
        },
      });
      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz-2',
            locationId: 'loc-biz2-1',
          }),
        }),
      );
      expect(result.id).toBe('user-csh-biz2');
    });

    it('rejects cashier creation when admin specifies a businessId they do not own', async () => {
      const admin = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1'],
      };

      await expect(
        service.createCashier(admin, {
          businessId: 'biz-unowned',
          fullName: 'Unauthorized Cashier',
          password: 'password123',
          locationId: 'loc-1',
          monthlySalary: 20000,
        }),
      ).rejects.toThrow('You do not have access to this business');
    });

    it('updates cashier under a specified secondary business owned by admin', async () => {
      userFindFirst.mockResolvedValue({
        id: 'csh-biz2',
        businessId: 'biz-2',
        role: Role.CASHIER,
      });
      locationFindFirst.mockResolvedValue({
        id: 'loc-biz2-new',
        businessId: 'biz-2',
        deletedAt: null,
      });
      userUpdate.mockResolvedValue({
        id: 'csh-biz2',
        fullName: 'Kamal Updated',
        locationId: 'loc-biz2-new',
        location: { id: 'loc-biz2-new', name: 'Biz2 New Branch' },
      });

      const admin = {
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
        businessIds: ['biz-1', 'biz-2'],
      };

      const result = await service.updateCashier(admin, 'csh-biz2', {
        businessId: 'biz-2',
        fullName: 'Kamal Updated',
        locationId: 'loc-biz2-new',
      });

      expect(locationFindFirst).toHaveBeenCalledWith({
        where: { id: 'loc-biz2-new', businessId: 'biz-2', deletedAt: null },
      });
      expect(result.fullName).toBe('Kamal Updated');
    });
  });
});
