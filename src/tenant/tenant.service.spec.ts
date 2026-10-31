import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role, ShiftStatus } from '@prisma/client';
import { resolveLocationScope } from '../common/utils/location-scope';
import { AuthService } from '../auth/auth.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from './tenant.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
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

describe('TenantService', () => {
  const businessFindMany = jest.fn();
  const businessFindFirst = jest.fn();
  const businessCreate = jest.fn();
  const businessUpdate = jest.fn();
  const locationFindMany = jest.fn();
  const locationFindFirst = jest.fn();
  const locationCreate = jest.fn();
  const locationUpdate = jest.fn();
  const locationUpdateMany = jest.fn();
  const locationCount = jest.fn();
  const userFindUnique = jest.fn();
  const userUpdate = jest.fn();
  const userFindUniqueOrThrow = jest.fn();
  const shiftSessionFindFirst = jest.fn();

  const prisma = {
    $transaction: jest.fn((cb) => cb(prisma)),
    business: {
      findMany: businessFindMany,
      findFirst: businessFindFirst,
      create: businessCreate,
      update: businessUpdate,
    },
    location: {
      findMany: locationFindMany,
      findFirst: locationFindFirst,
      create: locationCreate,
      update: locationUpdate,
      updateMany: locationUpdateMany,
      count: locationCount,
    },
    user: {
      findUnique: userFindUnique,
      update: userUpdate,
      findUniqueOrThrow: userFindUniqueOrThrow,
    },
    shiftSession: {
      findFirst: shiftSessionFindFirst,
    },
  } as unknown as PrismaService;

  const authService = {
    signAccessToken: jest.fn().mockResolvedValue('signed-token'),
  } as unknown as AuthService;

  const cloudinary = {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
  } as unknown as CloudinaryService;

  const service = new TenantService(prisma, authService, cloudinary);

  beforeEach(() => {
    businessFindMany.mockReset();
    businessFindFirst.mockReset();
    businessCreate.mockReset();
    businessUpdate.mockReset();
    locationFindMany.mockReset();
    locationFindFirst.mockReset();
    locationCreate.mockReset();
    locationUpdate.mockReset();
    locationUpdateMany.mockReset();
    userFindUnique.mockReset();
    userUpdate.mockReset();
    userFindUniqueOrThrow.mockReset();
    shiftSessionFindFirst.mockReset();
    (authService.signAccessToken as jest.Mock).mockClear();
  });

  describe('listBusinesses', () => {
    it('returns all businesses owned by the admin including locations', async () => {
      const mockBusinesses = [
        {
          id: 'biz-1',
          name: 'Business 1',
          ownerId: 'admin-1',
          locations: [{ id: 'loc-1', name: 'Branch 1' }],
        },
        {
          id: 'biz-2',
          name: 'Business 2',
          ownerId: 'admin-1',
          locations: [],
        },
      ];
      businessFindMany.mockResolvedValue(mockBusinesses);

      const result = await service.listBusinesses({
        sub: 'admin-1',
        role: Role.ADMIN,
      });

      expect(result).toEqual(mockBusinesses);
      expect(businessFindMany).toHaveBeenCalledWith({
        where: { ownerId: 'admin-1', deletedAt: null },
        select: expect.objectContaining({
          id: true,
          name: true,
          locations: expect.any(Object),
        }),
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createBusiness', () => {
    it('creates a new business for admin and sets as active with accessToken', async () => {
      businessFindFirst.mockResolvedValue(null);
      businessCreate.mockResolvedValue({
        id: 'biz-new',
        name: 'New Business',
        ownerId: 'admin-1',
      });
      userUpdate.mockResolvedValue({ id: 'admin-1', businessId: 'biz-new' });

      const result = await service.createBusiness(
        { sub: 'admin-1', role: Role.ADMIN },
        { name: 'New Business' },
      );

      expect(result.business.id).toBe('biz-new');
      expect(result.accessToken).toBe('signed-token');
      expect(businessCreate).toHaveBeenCalledWith({
        data: {
          name: 'New Business',
          ownerId: 'admin-1',
        },
        select: expect.any(Object),
      });
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { businessId: 'biz-new' },
      });
      expect(authService.signAccessToken).toHaveBeenCalled();
    });

    it('throws ConflictException if admin already has a business with the same name', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-existing' });

      await expect(
        service.createBusiness(
          { sub: 'admin-1', role: Role.ADMIN },
          { name: 'Existing Business' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('selectBusiness', () => {
    it('switches active business and issues updated accessToken', async () => {
      businessFindFirst.mockResolvedValue({
        id: 'biz-2',
        name: 'Second Business',
        ownerId: 'admin-1',
      });
      userUpdate.mockResolvedValue({ id: 'admin-1', businessId: 'biz-2' });

      const result = await service.selectBusiness(
        { sub: 'admin-1', role: Role.ADMIN },
        'biz-2',
      );

      expect(result.business.id).toBe('biz-2');
      expect(result.accessToken).toBe('signed-token');
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { businessId: 'biz-2' },
      });
      expect(authService.signAccessToken).toHaveBeenCalled();
    });

    it('throws BadRequestException if businessId is empty', async () => {
      await expect(
        service.selectBusiness({ sub: 'admin-1', role: Role.ADMIN }, ''),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException if business does not exist', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(
        service.selectBusiness(
          { sub: 'admin-1', role: Role.ADMIN },
          'non-existent',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException if business belongs to another owner', async () => {
      businessFindFirst.mockResolvedValue({
        id: 'biz-other',
        name: 'Other Business',
        ownerId: 'other-admin',
      });

      await expect(
        service.selectBusiness(
          { sub: 'admin-1', role: Role.ADMIN },
          'biz-other',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateBusiness', () => {
    it('updates business name if owned by admin', async () => {
      businessFindFirst
        .mockResolvedValueOnce({ id: 'biz-1', ownerId: 'admin-1' })
        .mockResolvedValueOnce(null);
      businessUpdate.mockResolvedValue({
        id: 'biz-1',
        name: 'Updated Name',
      });

      const result = await service.updateBusiness(
        { sub: 'admin-1', role: Role.ADMIN },
        'biz-1',
        { name: 'Updated Name' },
      );

      expect(result.name).toBe('Updated Name');
      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'biz-1' },
        data: { name: 'Updated Name' },
        select: expect.any(Object),
      });
    });

    it('throws ConflictException if new name conflicts with another owned business', async () => {
      businessFindFirst
        .mockResolvedValueOnce({ id: 'biz-1', ownerId: 'admin-1' })
        .mockResolvedValueOnce({ id: 'biz-2', name: 'Duplicate' });

      await expect(
        service.updateBusiness({ sub: 'admin-1', role: Role.ADMIN }, 'biz-1', {
          name: 'Duplicate',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deleteBusiness', () => {
    it('throws ConflictException if business has active branches', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-1', ownerId: 'admin-1' });
      locationCount.mockResolvedValue(1);

      await expect(
        service.deleteBusiness({ sub: 'admin-1', role: Role.ADMIN }, 'biz-1'),
      ).rejects.toThrow(
        'Cannot delete business with existing branch locations. Please delete all branches first.',
      );
    });

    it('throws ConflictException if any branch has an open shift', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-1', ownerId: 'admin-1' });
      locationCount.mockResolvedValue(0);
      shiftSessionFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: ShiftStatus.OPEN,
      });

      await expect(
        service.deleteBusiness({ sub: 'admin-1', role: Role.ADMIN }, 'biz-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('soft deletes business when no branches exist', async () => {
      businessFindFirst.mockResolvedValue({
        id: 'biz-1',
        name: 'Biz 1',
        ownerId: 'admin-1',
      });
      locationCount.mockResolvedValue(0);
      shiftSessionFindFirst.mockResolvedValue(null);

      const result = await service.deleteBusiness(
        { sub: 'admin-1', role: Role.ADMIN },
        'biz-1',
      );

      expect(result.id).toBe('biz-1');
      expect(locationCount).toHaveBeenCalledWith({
        where: { businessId: 'biz-1', deletedAt: null },
      });
      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'biz-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getBusiness', () => {
    it('returns business profile when found', async () => {
      businessFindFirst.mockResolvedValue({
        id: 'biz-1',
        name: 'SunTech Retail',
        ownerId: 'admin-1',
      });

      const result = await service.getBusiness('biz-1');
      expect(result.id).toBe('biz-1');
      expect(businessFindFirst).toHaveBeenCalledWith({
        where: { id: 'biz-1', deletedAt: null },
        select: expect.any(Object),
      });
    });

    it('throws NotFoundException if business is not found', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(service.getBusiness('biz-unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getLocations', () => {
    it('returns locations for cashier scoped to assigned location', async () => {
      locationFindMany.mockResolvedValue([
        { id: 'loc-1', name: 'Uttara Branch', address: 'Dhaka' },
      ]);

      const result = await service.getLocations(
        {
          sub: 'cashier-1',
          role: Role.CASHIER,
          businessId: 'biz-1',
          locationId: 'loc-1',
        },
        'biz-other',
        'loc-other',
      );
      expect(result).toHaveLength(1);
      expect(locationFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          businessId: 'biz-1',
          deletedAt: null,
          id: 'loc-1',
        }),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns locations for admin scoped to requested businessId', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-2', ownerId: 'admin-1' });
      locationFindMany.mockResolvedValue([
        { id: 'loc-2', name: 'Gulshan Branch', address: 'Dhaka' },
      ]);

      const result = await service.getLocations(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'biz-2',
      );
      expect(result).toHaveLength(1);
      expect(locationFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          businessId: 'biz-2',
          deletedAt: null,
        }),
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('updateLocation', () => {
    it('updates location name and address when owned by admin', async () => {
      locationFindFirst
        .mockResolvedValueOnce({
          id: 'loc-1',
          businessId: 'biz-1',
          business: { ownerId: 'admin-1' },
        })
        .mockResolvedValueOnce(null);
      locationUpdate.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara New Branch',
        address: 'Sector 3',
      });

      const result = await service.updateLocation(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'loc-1',
        { name: 'Uttara New Branch', address: 'Sector 3' },
      );

      expect(result.name).toBe('Uttara New Branch');
      expect(locationUpdate).toHaveBeenCalledWith({
        where: { id: 'loc-1' },
        data: { name: 'Uttara New Branch', address: 'Sector 3' },
      });
    });

    it('throws NotFoundException if location is not found or not owned by admin', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.updateLocation(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'loc-unknown',
          { name: 'New' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteLocation', () => {
    it('soft deletes location by setting deletedAt and suffixing name', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
        businessId: 'biz-1',
        business: { ownerId: 'admin-1' },
      });
      shiftSessionFindFirst.mockResolvedValue(null);
      locationUpdate.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch__del_123',
        deletedAt: new Date(),
      });

      const result = await service.deleteLocation(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'loc-1',
      );

      expect(result.id).toBe('loc-1');
      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(locationUpdate).toHaveBeenCalledWith({
        where: { id: 'loc-1' },
        data: {
          deletedAt: expect.any(Date),
          name: expect.stringContaining('Uttara Branch__del_'),
        },
      });
    });

    it('throws NotFoundException if location to delete is not found', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.deleteLocation(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'loc-unknown',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveLocationScope', () => {
    it('resolves businessId and requested locationId for admin', () => {
      const scope = resolveLocationScope(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'loc-2',
      );
      expect(scope).toEqual({ businessId: 'biz-1', locationId: 'loc-2' });
    });

    it('resolves all locations (undefined locationId) for admin when omitted', () => {
      const scope = resolveLocationScope({
        sub: 'admin-1',
        role: Role.ADMIN,
        businessId: 'biz-1',
      });
      expect(scope).toEqual({ businessId: 'biz-1', locationId: undefined });
    });

    it('resolves assigned branch for cashier', () => {
      const scope = resolveLocationScope({
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-csh',
      });
      expect(scope).toEqual({ businessId: 'biz-1', locationId: 'loc-csh' });
    });

    it('ignores requested business and location IDs for cashier scope', () => {
      expect(
        resolveLocationScope(
          {
            sub: 'cashier-1',
            role: Role.CASHIER,
            businessId: 'biz-1',
            locationId: 'loc-1',
          },
          'loc-2',
          'biz-2',
        ),
      ).toEqual({ businessId: 'biz-1', locationId: 'loc-1' });
    });

    it('throws ForbiddenException when cashier has no locationId in token', () => {
      expect(() =>
        resolveLocationScope({
          sub: 'cashier-1',
          role: Role.CASHIER,
          businessId: 'biz-1',
          locationId: null,
        }),
      ).toThrow(
        'Cashier account must be assigned to an active business and branch location',
      );
    });

    it('throws ForbiddenException when actor has no businessId', () => {
      expect(() =>
        resolveLocationScope({
          sub: 'user-1',
          role: Role.ADMIN,
          businessId: null,
        }),
      ).toThrow('Business context is required');
    });
  });

  describe('createLocation', () => {
    it('creates location when name and address combination is unique', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-1', ownerId: 'admin-1' });
      locationFindFirst.mockResolvedValue(null);
      locationCreate.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
        address: 'Sector 3',
        businessId: 'biz-1',
      });

      const result = await service.createLocation(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        { name: 'Uttara Branch', address: 'Sector 3', businessId: 'biz-1' },
      );

      expect(result.id).toBe('loc-1');
      expect(locationFindFirst).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-1',
          name: { equals: 'Uttara Branch', mode: 'insensitive' },
          address: { equals: 'Sector 3', mode: 'insensitive' },
          deletedAt: null,
        },
      });
      expect(locationCreate).toHaveBeenCalledWith({
        data: {
          name: 'Uttara Branch',
          address: 'Sector 3',
          businessId: 'biz-1',
        },
      });
    });

    it('allows branch with same name if address is different', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-1', ownerId: 'admin-1' });
      locationFindFirst.mockResolvedValue(null);
      locationCreate.mockResolvedValue({
        id: 'loc-2',
        name: 'Uttara Branch',
        address: 'Sector 11',
        businessId: 'biz-1',
      });

      const result = await service.createLocation(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        { name: 'Uttara Branch', address: 'Sector 11', businessId: 'biz-1' },
      );

      expect(result.id).toBe('loc-2');
    });

    it('throws ConflictException if branch with same name and address exists in business', async () => {
      businessFindFirst.mockResolvedValue({ id: 'biz-1', ownerId: 'admin-1' });
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
        address: 'Sector 3',
        businessId: 'biz-1',
      });

      await expect(
        service.createLocation(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          { name: 'Uttara Branch', address: 'Sector 3', businessId: 'biz-1' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('setBusinessProfileImage', () => {
    it('uploads new image first, updates record with url and keys, and deletes previous image', async () => {
      businessFindFirst
        .mockResolvedValueOnce({ id: 'biz-1', ownerId: 'admin-1' })
        .mockResolvedValueOnce({
          id: 'biz-1',
          ownerId: 'admin-1',
          profileImagePublicId: 'old-public-id',
          profileImageKey: 'old-public-id',
        });
      (cloudinary.uploadImage as jest.Mock).mockResolvedValue({
        url: 'https://cloudinary.com/new.jpg',
        publicId: 'new-public-id',
      });
      businessUpdate.mockResolvedValue({
        id: 'biz-1',
        name: 'Biz 1',
        ownerId: 'admin-1',
        profileImageUrl: 'https://cloudinary.com/new.jpg',
        profileImagePublicId: 'new-public-id',
        profileImageKey: 'new-public-id',
      });

      const file = {
        buffer: Buffer.from('image-data'),
        mimetype: 'image/jpeg',
        size: 1024,
      };

      const result = await service.setBusinessProfileImage(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        file,
        'biz-1',
      );

      expect(cloudinary.uploadImage).toHaveBeenCalledWith(
        file,
        'suntech/businesses/biz-1',
      );
      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'biz-1' },
        data: {
          profileImageUrl: 'https://cloudinary.com/new.jpg',
          profileImagePublicId: 'new-public-id',
          profileImageKey: 'new-public-id',
        },
        select: expect.objectContaining({
          profileImageUrl: true,
          profileImagePublicId: true,
          profileImageKey: true,
        }),
      });
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('old-public-id');
      expect(result.profileImageUrl).toBe('https://cloudinary.com/new.jpg');
    });

    it('cleans up newly uploaded image if database update fails', async () => {
      businessFindFirst
        .mockResolvedValueOnce({ id: 'biz-1', ownerId: 'admin-1' })
        .mockResolvedValueOnce({
          id: 'biz-1',
          ownerId: 'admin-1',
          profileImagePublicId: 'old-public-id',
        });
      (cloudinary.uploadImage as jest.Mock).mockResolvedValue({
        url: 'https://cloudinary.com/new.jpg',
        publicId: 'new-public-id',
      });
      businessUpdate.mockRejectedValue(new Error('DB connection failure'));

      const file = {
        buffer: Buffer.from('image-data'),
        mimetype: 'image/jpeg',
        size: 1024,
      };

      await expect(
        service.setBusinessProfileImage(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          file,
          'biz-1',
        ),
      ).rejects.toThrow('DB connection failure');

      expect(cloudinary.deleteImage).toHaveBeenCalledWith('new-public-id');
    });
  });

  describe('clearBusinessProfileImage', () => {
    it('clears image urls and keys, and removes image from cloud storage', async () => {
      businessFindFirst
        .mockResolvedValueOnce({ id: 'biz-1', ownerId: 'admin-1' })
        .mockResolvedValueOnce({
          id: 'biz-1',
          ownerId: 'admin-1',
          profileImagePublicId: 'old-public-id',
        });
      businessUpdate.mockResolvedValue({
        id: 'biz-1',
        name: 'Biz 1',
        ownerId: 'admin-1',
        profileImageUrl: null,
        profileImagePublicId: null,
        profileImageKey: null,
      });

      const result = await service.clearBusinessProfileImage(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'biz-1',
      );

      expect(businessUpdate).toHaveBeenCalledWith({
        where: { id: 'biz-1' },
        data: {
          profileImageUrl: null,
          profileImagePublicId: null,
          profileImageKey: null,
        },
        select: expect.any(Object),
      });
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('old-public-id');
      expect(result.profileImageUrl).toBeNull();
    });
  });
});
