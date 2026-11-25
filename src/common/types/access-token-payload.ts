import { Role } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  publicId?: string | null;
  businessId?: string | null;
  locationId?: string | null;
  businessIds?: string[];
  locationIds?: string[];
  sessionId?: string | null;
}

export interface PasswordResetTokenPayload {
  sub: string;
  purpose: 'password-reset';
}

export interface RefreshTokenPayload {
  sub: string;
  purpose: 'refresh';
  sessionId?: string | null;
}
