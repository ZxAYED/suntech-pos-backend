import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus, Role } from '@prisma/client';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../../common/types/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';

export function extractCleanJwt(request: Request): string | null {
  if (!request) return null;

  // 1. Check Authorization header
  const authHeader = request.headers?.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const raw = authHeader.trim();
    const match = raw.match(/^bearer\s+(.+)$/i);
    if (match) {
      let token = (match[1] ?? '').trim();
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
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        publicId: true,
        role: true,
        status: true,
        businessId: true,
        locationId: true,
        ownedBusinesses: {
          where: { deletedAt: null },
          select: {
            id: true,
            locations: {
              where: { deletedAt: null },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    if (user.role === Role.CASHIER) {
      if (!user.businessId || !user.locationId) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }

      const location = await this.prisma.location.findFirst({
        where: {
          id: user.locationId,
          businessId: user.businessId,
          deletedAt: null,
          business: { deletedAt: null },
        },
        select: { id: true },
      });
      if (!location) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }

      return {
        sub: user.id,
        role: user.role,
        publicId: user.publicId,
        businessId: user.businessId,
        locationId: user.locationId,
        businessIds: [user.businessId],
        locationIds: [user.locationId],
      };
    }

    const businessIds = user.ownedBusinesses.map((business) => business.id);
    const locationIds = user.ownedBusinesses.flatMap((business) =>
      business.locations.map((location) => location.id),
    );
    const businessId = businessIds.includes(user.businessId ?? '')
      ? user.businessId
      : (businessIds[0] ?? null);

    return {
      sub: user.id,
      role: user.role,
      publicId: user.publicId,
      businessId,
      locationId: null,
      businessIds,
      locationIds,
    };
  }
}
