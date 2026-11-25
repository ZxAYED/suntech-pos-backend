import { Reflector } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ATOMIC_IDEMPOTENCY_KEY, requireAtomicReceipt } from './atomic-idempotency';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

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
    it('retains an expired pending record because the financial transaction may already have committed', async () => {
      const record = {
        id: 'old-uncertain-record',
        statusCode: 0,
        responseBody: { pending: true },
        path: '/api/v1/orders/custom',
        requestHash: 'same-hash',
        expiresAt: new Date(Date.now() - 30 * 86400 * 1000),
      };
      const storage = {
        findUnique: jest.fn().mockResolvedValue(record),
        deleteMany: jest.fn(),
      };
      (interceptor as any).prisma.idempotencyRecord = storage;
      await expect(
        (interceptor as any).readReplay(
          'user-1:biz-1',
          'original-key',
          record.path,
          'same-hash',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteMany).not.toHaveBeenCalled();
    });
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
      expect(
        (interceptor as any).prisma.idempotencyRecord.deleteMany,
      ).not.toHaveBeenCalled();
    });
  });

  it('returns the domain-committed envelope without a second reservation or response write', async () => {
    const storage = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
    const reflect = {
      getAllAndOverride: () => true,
      get: (key: string) => key === ATOMIC_IDEMPOTENCY_KEY ? true : key === RESPONSE_MESSAGE_KEY ? 'Refund completed' : 201,
    };
    const subject = new IdempotencyInterceptor(reflect as never, { idempotencyRecord: storage } as never);
    const request = { method: 'POST', path: '/api/v1/orders/order-1/refunds', body: { items: [] }, query: {}, user: { sub: 'u', businessId: 'b' }, header: () => 'original-key' };
    const status = jest.fn();
    const context = { getHandler: () => () => {}, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ status }) }) };
    const envelope = { success: true, message: 'Refund completed', data: { id: 'refund-1' }, timestamp: '2026-01-01T00:00:00.000Z' };
    const handler = { handle: () => {
      const receipt = requireAtomicReceipt(request);
      expect(receipt.key).toBe('original-key');
      expect(receipt.scopeId).toBe('u:b');
      expect(receipt.statusCode).toBe(201);
      receipt.response = { statusCode: 201, responseBody: envelope };
      return of({ data: envelope });
    } };
    expect(await firstValueFrom(await subject.intercept(context as never, handler))).toEqual(envelope);
    expect(status).toHaveBeenCalledWith(201);
    expect(storage.findUnique).not.toHaveBeenCalled();
    expect(storage.create).not.toHaveBeenCalled();
    expect(storage.update).not.toHaveBeenCalled();
  });

  describe('uncertain outcome handling', () => {
    function setup(handlerError: Error) {
      const db = {
        idempotencyRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'request-1' }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn(),
        },
      };
      const reflect = { getAllAndOverride: () => true, get: () => 201 };
      const subject = new IdempotencyInterceptor(reflect as never, db as never);
      const request = {
        method: 'POST',
        path: '/api/v1/orders/custom',
        query: {},
        body: {},
        user: { sub: 'user-1', businessId: 'biz-1' },
        header: (name: string) =>
          name === 'idempotency-key' ? 'old-non-uuid-key' : undefined,
      };
      const context = {
        getHandler: () => () => {},
        getClass: () => class {},
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({ status: jest.fn() }),
        }),
      };
      const handler = { handle: () => throwError(() => handlerError) };
      return { db, subject, context, handler };
    }

    it('keeps the original request identity after an unexpected server failure', async () => {
      const { db, subject, context, handler } = setup(
        new InternalServerErrorException(
          'Response failed after possible commit',
        ),
      );
      await expect(
        firstValueFrom(await subject.intercept(context as never, handler)),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(db.idempotencyRecord.deleteMany).not.toHaveBeenCalled();
    });

    it('allows correction after a definitive input rejection', async () => {
      const { db, subject, context, handler } = setup(
        new BadRequestException('Tender invalid before posting'),
      );
      await expect(
        firstValueFrom(await subject.intercept(context as never, handler)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          scopeId: 'user-1:biz-1',
          key: 'old-non-uuid-key',
          statusCode: 0,
        },
      });
    });
  });
});
