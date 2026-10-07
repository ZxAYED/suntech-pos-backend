import { Injectable, UnauthorizedException } from '@nestjs/common';
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

    return {
      sub: payload.sub,
      role: payload.role,
      publicId: payload.publicId,
      businessId: payload.businessId,
      locationId: payload.locationId,
    };
  }
}
