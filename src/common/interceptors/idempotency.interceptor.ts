import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpStatus,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { isUniqueConstraintError } from '../prisma/is-unique-constraint.error';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload } from '../types/access-token-payload';
import { ATOMIC_IDEMPOTENCY_KEY, attachAtomicReceipt, type AtomicReceiptContext } from './atomic-idempotency';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { toStoredJson } from './to-stored-json';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_STATUS = 0;
const MAX_KEY_LENGTH = 200;

type RequestWithUser = Request & { user?: AccessTokenPayload };

type StoredResponse = {
  statusCode: number;
  responseBody: Prisma.JsonValue;
};

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const response = http.getResponse<Response>();
    const method = request.method.toUpperCase();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const key = request.header('idempotency-key')?.trim();

    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException('Idempotency-Key is too long');
    }

    const scopeId = this.resolveScopeId(request);
    const path = request.path;
    const requestHash = this.requestHash(request);
    if (this.reflector.get<boolean>(ATOMIC_IDEMPOTENCY_KEY, context.getHandler()) === true) {
      const receipt: AtomicReceiptContext = {
        scopeId, key, path, requestHash,
        statusCode: this.reflector.get<number>('__httpCode__', context.getHandler()) ?? (method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK),
        message: this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ?? 'Request successful',
      };
      attachAtomicReceipt(request, receipt);
      // No out-of-transaction reservation or completion for this handler. It must
      // co-commit the exact HTTP envelope with its domain writes.
      return next.handle().pipe(map(() => {
        if (!receipt.response) throw new InternalServerErrorException('Atomic financial receipt missing');
        response.status(receipt.response.statusCode);
        return receipt.response.responseBody;
      }));
    }
    await this.reserveSaleProtocol(request, key);
    const replay = await this.resolveReplay(scopeId, key, path, requestHash);

    if (replay) {
      response.status(replay.statusCode);
      return of(replay.responseBody);
    }

    const explicitStatus = this.reflector.get<number>(
      '__httpCode__',
      context.getHandler(),
    );
    const statusCode =
      explicitStatus ??
      (method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    return next.handle().pipe(
      catchError((error: unknown) => {
        // A server/transport error may arrive after the financial transaction committed.
        // Release only definitive input/permission failures; keep uncertain effects for review.
        const definitelyRejected =
          error instanceof HttpException &&
          [400, 401, 403, 404, 422].includes(error.getStatus());
        return definitelyRejected
          ? from(this.releaseLock(scopeId, key)).pipe(
              mergeMap(() => throwError(() => error)),
            )
          : throwError(() => error);
      }),
      mergeMap((body: unknown) =>
        from(
          this.storeSuccess(scopeId, key, statusCode, body).catch((err) => {
            this.logger.warn(
              `Failed to record idempotency success for key ${key}: ${err?.message}`,
            );
          }),
        ).pipe(mergeMap(() => of(body))),
      ),
    );
  }

  private async reserveSaleProtocol(
    request: RequestWithUser,
    key: string,
  ): Promise<void> {
    if (
      !/\/orders(?:\/(?:catalog|custom))?$/.test(request.path) ||
      !request.user?.sub ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      return;
    const context = {
      userId: request.user.sub,
      businessId: request.user.businessId ?? null,
      locationId: request.user.locationId ?? null,
      protocol: 'LEGACY_HTTP',
      legacyPath: request.path,
    };
    try {
      await this.prisma.financialSaleIdentity.create({
        data: { id: key, ...context },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const owner = await this.prisma.financialSaleIdentity.findUnique({
        where: { id: key },
      });
      if (
        !owner ||
        owner.protocol !== context.protocol ||
        owner.userId !== context.userId ||
        owner.businessId !== context.businessId ||
        owner.locationId !== context.locationId ||
        owner.legacyPath !== context.legacyPath
      ) {
        throw new ConflictException({
          code: 'SALE_PROTOCOL_CONFLICT',
          message:
            'This purchase identity belongs to another checkout protocol or scope. Recover it using the original route.',
        });
      }
    }
    // Existing v1/v2 accepted sync orders predate or may not yet have this registry row.
    const synced = await this.prisma.order.findUnique({
      where: { clientOrderId: key },
      select: { id: true },
    });
    if (synced)
      throw new ConflictException({
        code: 'SALE_PROTOCOL_CONFLICT',
        message:
          'This purchase was already sent through order synchronization. Reuse its saved sync event.',
      });
  }

  private resolveScopeId(request: RequestWithUser): string {
    if (request.user?.sub) {
      const biz = request.user.businessId ? `:${request.user.businessId}` : '';
      return `${request.user.sub}${biz}`;
    }

    const forwarded = request.header('x-forwarded-for');
    const client = forwarded?.split(',')[0]?.trim();

    return client || request.ip || request.socket.remoteAddress || 'anonymous';
  }

  private requestHash(request: RequestWithUser): string {
    const canonical = JSON.stringify({
      method: request.method.toUpperCase(),
      path: request.path,
      query: this.sortValue(request.query ?? null),
      body: this.sortValue(request.body ?? null),
      businessId: request.user?.businessId ?? null,
      locationId: request.user?.locationId ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortValue(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, this.sortValue(item)]),
      );
    }
    return value;
  }

  private async resolveReplay(
    scopeId: string,
    key: string,
    path: string,
    requestHash: string,
  ): Promise<StoredResponse | null> {
    const existing = await this.readReplay(scopeId, key, path, requestHash);

    if (existing) {
      return existing;
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key,
          scopeId,
          path,
          requestHash,
          statusCode: PENDING_STATUS,
          responseBody: { pending: true },
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return null;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const replay = await this.readReplay(scopeId, key, path, requestHash);

      if (!replay) {
        throw new ConflictException(
          'A request with this idempotency key is already in progress',
        );
      }

      return replay;
    }
  }

  private async readReplay(
    scopeId: string,
    key: string,
    path: string,
    requestHash: string,
  ): Promise<StoredResponse | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scopeId_key: { scopeId, key } },
    });

    if (!existing) {
      return null;
    }

    // An expired PENDING lock is not proof that no sale happened. A process can
    // crash after domain commit and before storeSuccess. Retain both pending
    // and completed identities until an authoritative recovery resolves them.

    if (existing.path !== path) {
      throw new ConflictException(
        'Idempotency key was already used for a different request',
      );
    }
    if (existing.requestHash && existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different request body',
      );
    }

    if (existing.statusCode === PENDING_STATUS) {
      throw new ConflictException(
        'A request with this idempotency key is already in progress',
      );
    }

    return {
      statusCode: existing.statusCode,
      responseBody: existing.responseBody,
    };
  }

  private async storeSuccess(
    scopeId: string,
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const responseBody = toStoredJson(body);

    await this.prisma.idempotencyRecord.update({
      where: { scopeId_key: { scopeId, key } },
      data: { statusCode, responseBody },
    });
  }

  private async releaseLock(scopeId: string, key: string): Promise<void> {
    await this.prisma.idempotencyRecord
      .deleteMany({
        where: { scopeId, key, statusCode: PENDING_STATUS },
      })
      .catch(() => undefined);
  }
}
