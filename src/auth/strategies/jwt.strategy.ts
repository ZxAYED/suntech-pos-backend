import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../../common/types/access-token-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload {
    const roles = Object.values(Role);

    if (!payload?.sub || !roles.includes(payload.role)) {
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

    return {
      sub: payload.sub,
      role: payload.role,
      publicId: payload.publicId,
      businessId: payload.businessId,
      locationId: payload.locationId,
    };
  }
}
