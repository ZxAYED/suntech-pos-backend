import { Role } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  publicId?: string | null;
  businessId?: string | null;
  locationId?: string | null;
}

export interface PasswordResetTokenPayload {
  sub: string;
  purpose: 'password-reset';
}

export interface RefreshTokenPayload {
  sub: string;
  purpose: 'refresh';
}
