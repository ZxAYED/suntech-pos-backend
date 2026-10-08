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
    } satisfies ApiErrorResponse);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (this.isOversizedUpload(exception)) {
      return HttpStatus.BAD_REQUEST;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exception: unknown): string {
    if (this.isOversizedUpload(exception)) {
      return 'Image must be 5 MB or smaller';
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

  private isOversizedUpload(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      exception.name === 'MulterError' &&
      'code' in exception &&
      exception.code === 'LIMIT_FILE_SIZE'
    );
  }
}
