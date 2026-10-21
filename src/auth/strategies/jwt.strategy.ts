import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../../common/types/access-token-payload';

export function extractCleanJwt(request: Request): string | null {
  if (!request) return null;

  // 1. Check Authorization header
  const authHeader = request.headers?.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const raw = authHeader.trim();
    const match = raw.match(/^bearer\s+(.+)$/i);
    if (match) {
      let token = match[1].trim();
      while (token.toLowerCase().startsWith('bearer ')) {
        token = token.slice(7).trim();
      }
      token = token.replace(/^[\\"'`]+|[\\"'`]+$/g, '').trim();
      if (token) return token;
    }
  }

  // 2. Check cookies
  if (request.cookies) {
    const fromCookie = request.cookies.accessToken || request.cookies.token;
    if (fromCookie && typeof fromCookie === 'string') {
      let raw = fromCookie.trim();
      raw = raw.replace(/^[\\"'`]+|[\\"'`]+$/g, '').trim();
      if (raw) return raw;
    }
  }

  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: extractCleanJwt,
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AccessTokenPayload> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid access token');
    }

    if (payload.role === Role.CASHIER) {
      if (
        !payload.businessId ||
        !payload.locationId ||
        typeof payload.businessId !== 'string' ||
        typeof payload.locationId !== 'string'
      ) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
    }

    return payload;
  }
}
