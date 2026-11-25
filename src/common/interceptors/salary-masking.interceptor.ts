import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Observable, map } from 'rxjs';
import { AccessTokenPayload } from '../types/access-token-payload';

import { sanitizeResponseData } from './sanitize-response-data';
export { sanitizeResponseData, stripMonthlySalary } from './sanitize-response-data';

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

