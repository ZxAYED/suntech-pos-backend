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
      mockReflector as unknown as Reflector,
      mockPrisma as unknown as PrismaService,
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

  describe('resolveScopeId', () => {
    it('scopes user sub with businessId when user is authenticated', () => {
      const req: any = {
        user: { sub: 'user-123', businessId: 'biz-456' },
      };
      const scope = (interceptor as any).resolveScopeId(req);
      expect(scope).toBe('user-123:biz-456');
    });

    it('falls back to client ip when user is unauthenticated', () => {
      const req: any = {
        header: () => undefined,
        ip: '192.168.1.1',
        socket: {},
      };
      const scope = (interceptor as any).resolveScopeId(req);
      expect(scope).toBe('192.168.1.1');
    });
  });

  describe('readReplay', () => {
    it('replays completed response even if expiresAt has passed (permanent replay protection O07)', async () => {
      (interceptor as any).prisma.idempotencyRecord = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rec-1',
          statusCode: 201,
          responseBody: { success: true },
          path: '/api/v1/orders',
          requestHash: 'hash-abc',
          expiresAt: new Date(Date.now() - 1000), // expired 1s ago
        }),
        deleteMany: jest.fn(),
      };

      const replay = await (interceptor as any).readReplay(
        'user-1:biz-1',
        'key-1',
        '/api/v1/orders',
        'hash-abc',
      );

      expect(replay).toEqual({
        statusCode: 201,
        responseBody: { success: true },
      });
      expect((interceptor as any).prisma.idempotencyRecord.deleteMany).not.toHaveBeenCalled();
    });
  });
});
