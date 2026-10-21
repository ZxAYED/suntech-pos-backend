import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
  const businessFindFirst = jest.fn();
  const businessCreate = jest.fn();
  const businessUpdate = jest.fn();
  const locationFindMany = jest.fn();
  const locationFindFirst = jest.fn();
  const locationCreate = jest.fn();
  const locationUpdate = jest.fn();
  const locationUpdateMany = jest.fn();
  const userUpdate = jest.fn();
  const userFindUniqueOrThrow = jest.fn();

  const prisma = {
    business: {
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
    },
    user: {
      update: userUpdate,
      findUniqueOrThrow: userFindUniqueOrThrow,
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
    businessFindFirst.mockReset();
    businessCreate.mockReset();
    businessUpdate.mockReset();
    locationFindMany.mockReset();
    locationFindFirst.mockReset();
    locationCreate.mockReset();
    locationUpdate.mockReset();
    locationUpdateMany.mockReset();
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
    it('returns locations filtered by businessId, optional locationId, and search', async () => {
      locationFindMany.mockResolvedValue([
        { id: 'loc-1', name: 'Uttara Branch', address: 'Dhaka' },
      ]);

      const result = await service.getLocations('biz-1', 'loc-1', 'Uttara');
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
  });

  describe('updateLocation', () => {
    it('updates location name and address', async () => {
      locationFindFirst
        .mockResolvedValueOnce({
          id: 'loc-1',
          businessId: 'biz-1',
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

    it('throws NotFoundException if location is not found in business', async () => {
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
      });
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

    it('throws ForbiddenException when cashier tries to access another branch', () => {
      expect(() =>
        resolveLocationScope(
          {
            sub: 'cashier-1',
            role: Role.CASHIER,
            businessId: 'biz-1',
            locationId: 'loc-1',
          },
          'loc-2',
        ),
      ).toThrow('Cashiers can only access their assigned branch location');
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
});
