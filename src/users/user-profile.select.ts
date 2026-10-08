import { Prisma } from '@prisma/client';

export const userProfileSelect = {
  id: true,
  publicId: true,
  fullName: true,
  email: true,
  phoneNumber: true,
  role: true,
  status: true,
  statusReason: true,
  businessId: true,
  locationId: true,
  monthlySalary: true,
  profileImageUrl: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof userProfileSelect;
}>;

export type PresentedProfile = Omit<UserProfile, 'email'> & {
  email: string | null;
};

const INTERNAL_CASHIER_EMAIL_DOMAIN = '@cashiers.suntech.internal';

export function presentEmail(email: string): string | null {
  if (email.endsWith(INTERNAL_CASHIER_EMAIL_DOMAIN)) {
    return null;
  }

  return email;
}

export function presentProfile(profile: UserProfile): PresentedProfile {
  return { ...profile, email: presentEmail(profile.email) };
}

export function internalCashierEmail(publicId: string): string {
  return `${publicId.toLowerCase()}${INTERNAL_CASHIER_EMAIL_DOMAIN}`;
}
