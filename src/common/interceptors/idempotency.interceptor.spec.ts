import { Reflector } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PrismaService } from '../../prisma/prisma.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  const mockPrisma = {
    idempotentRequest: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new IdempotencyInterceptor(
      mockPrisma as unknown as PrismaService,
      mockReflector as unknown as Reflector,
    );
  });

  describe('requestHash', () => {
    it('produces different hashes when query parameters differ', () => {
      const req1: any = {
        method: 'GET',
        path: '/api/v1/orders',
        query: { locationId: 'loc-1' },
        body: null,
        user: { businessId: 'biz-1', locationId: 'loc-1' },
      };

      const req2: any = {
        method: 'GET',
        path: '/api/v1/orders',
        query: { locationId: 'loc-2' },
        body: null,
        user: { businessId: 'biz-1', locationId: 'loc-1' },
      };

      const hash1 = (interceptor as any).requestHash(req1);
      const hash2 = (interceptor as any).requestHash(req2);

      expect(hash1).not.toEqual(hash2);
    });

    it('produces the same hash regardless of query parameter key ordering', () => {
      const req1: any = {
        method: 'GET',
        path: '/api/v1/orders',
        query: { a: '1', b: '2' },
        body: null,
        user: { businessId: 'biz-1', locationId: 'loc-1' },
      };

      const req2: any = {
        method: 'GET',
        path: '/api/v1/orders',
        query: { b: '2', a: '1' },
        body: null,
        user: { businessId: 'biz-1', locationId: 'loc-1' },
      };

      const hash1 = (interceptor as any).requestHash(req1);
      const hash2 = (interceptor as any).requestHash(req2);

      expect(hash1).toEqual(hash2);
    });
  });
});
