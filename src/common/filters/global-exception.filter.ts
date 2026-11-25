import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

export interface ApiErrorResponse {
  success: false;
  message: string;
  timestamp: string;
  code?: string;
  variantId?: string;
  currentPrice?: number;
  submittedPrice?: number;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (response.headersSent) {
      return;
    }

    const status = this.resolveStatus(exception);

    if (status >= 500) {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(stack);
    }

    response.status(status).json({
      success: false,
      message: this.resolveMessage(exception),
      timestamp: new Date().toISOString(),
      ...this.safeDetails(exception),
    } satisfies ApiErrorResponse);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (this.isOversizedUpload(exception)) {
      return HttpStatus.BAD_REQUEST;
    }

    if (this.isOversizedBody(exception)) return HttpStatus.PAYLOAD_TOO_LARGE;

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exception: unknown): string {
    if (this.isOversizedUpload(exception)) {
      return 'Image must be 5 MB or smaller';
    }

    if (this.isOversizedBody(exception)) {
      return 'Request is too large. Split saved sales into smaller batches and keep their original IDs.';
    }

    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;

      if (Array.isArray(message)) {
        return message.map(String).join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  private safeDetails(exception: unknown): Partial<ApiErrorResponse> {
    if (this.isOversizedBody(exception)) return { code: 'REQUEST_TOO_LARGE' };
    if (!(exception instanceof HttpException)) return {};
    const body = exception.getResponse();
    if (!body || typeof body !== 'object') return {};
    const details = body as Record<string, unknown>;
    const result: Partial<ApiErrorResponse> = {};
    // Preserve the existing PRICE_CHANGED correction contract without leaking
    // arbitrary exception internals or database details into public responses.
    if (typeof details.code === 'string') result.code = details.code;
    if (typeof details.variantId === 'string')
      result.variantId = details.variantId;
    for (const key of ['currentPrice', 'submittedPrice'] as const) {
      if (typeof details[key] === 'number' && Number.isFinite(details[key]))
        result[key] = details[key];
    }
    return result;
  }

  private isOversizedBody(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large'
    );
  }

  private isOversizedUpload(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      exception.name === 'MulterError' &&
      'code' in exception &&
      exception.code === 'LIMIT_FILE_SIZE'
    );
  }
}
