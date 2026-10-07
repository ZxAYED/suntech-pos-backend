import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AccessTokenPayload } from '../types/access-token-payload';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<{
      user: AccessTokenPayload;
    }>();

    return request.user;
  },
);
