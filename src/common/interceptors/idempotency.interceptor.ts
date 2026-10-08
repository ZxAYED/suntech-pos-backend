import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { isUniqueConstraintError } from '../prisma/is-unique-constraint.error';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload } from '../types/access-token-payload';
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
    const replay = await this.resolveReplay(scopeId, key, path);

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
      mergeMap((body: unknown) =>
        from(this.storeSuccess(scopeId, key, statusCode, body)).pipe(
          mergeMap(() => of(body)),
        ),
      ),
      catchError((error: unknown) =>
        from(this.releaseLock(scopeId, key)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private resolveScopeId(request: RequestWithUser): string {
    if (request.user?.sub) {
      return request.user.sub;
    }

    const forwarded = request.header('x-forwarded-for');
    const client = forwarded?.split(',')[0]?.trim();

    return client || request.ip || request.socket.remoteAddress || 'anonymous';
  }

  private async resolveReplay(
    scopeId: string,
    key: string,
    path: string,
  ): Promise<StoredResponse | null> {
    const existing = await this.readReplay(scopeId, key, path);

    if (existing) {
      return existing;
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key,
          scopeId,
          path,
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

      const replay = await this.readReplay(scopeId, key, path);

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
  ): Promise<StoredResponse | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scopeId_key: { scopeId, key } },
    });

    if (!existing) {
      return null;
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.idempotencyRecord.delete({
        where: { id: existing.id },
      });
      return null;
    }

    if (existing.path !== path) {
      throw new ConflictException(
        'Idempotency key was already used for a different request',
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
