import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Observable, map } from 'rxjs';
import { AccessTokenPayload } from '../types/access-token-payload';

const CASHIER_HIDDEN_KEYS = new Set([
  'monthlySalary',
  'costPrice',
  'marginPercent',
  'inventoryValue',
  'salesRevenue',
  'salesCount',
]);

const SOFT_DELETE_REGEX = /__del_\d+$/;

@Injectable()
export class SalaryMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: AccessTokenPayload;
    }>();

    const isCashier = request.user?.role === Role.CASHIER;

    return next
      .handle()
      .pipe(map((data) => sanitizeResponseData(data, isCashier)));
  }
}

export function sanitizeResponseData(
  value: unknown,
  isCashier: boolean,
): unknown {
  if (typeof value === 'string') {
    return value.replace(SOFT_DELETE_REGEX, '');
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseData(item, isCashier));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const copy: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (isCashier && CASHIER_HIDDEN_KEYS.has(key)) {
      continue;
    }

    copy[key] = sanitizeResponseData(nested, isCashier);
  }

  return copy;
}

export function stripMonthlySalary(value: unknown): unknown {
  return sanitizeResponseData(value, true);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  if (value instanceof Date) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
