import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Observable, map } from 'rxjs';
import { AccessTokenPayload } from '../types/access-token-payload';

@Injectable()
export class SalaryMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: AccessTokenPayload;
    }>();

    if (request.user?.role !== Role.CASHIER) {
      return next.handle();
    }

    return next.handle().pipe(map((data) => stripMonthlySalary(data)));
  }
}

export function stripMonthlySalary(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripMonthlySalary(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const copy: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'monthlySalary') {
      continue;
    }

    copy[key] = stripMonthlySalary(nested);
  }

  return copy;
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
