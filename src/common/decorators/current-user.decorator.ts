import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AccessTokenPayload } from '../types/access-token-payload';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, context: ExecutionContext): unknown => {
    const request = context.switchToHttp().getRequest<{
      user?: AccessTokenPayload & { id?: string };
    }>();

    const user = request.user;
    if (!user) {
      return undefined;
    }

    if (data === 'id') {
      return user.id ?? user.sub;
    }

    if (data && typeof data === 'string') {
      return (user as unknown as Record<string, unknown>)[data];
    }

    return user;
  },
);
