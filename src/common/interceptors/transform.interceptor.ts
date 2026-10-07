import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      'Request successful';

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        message,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
