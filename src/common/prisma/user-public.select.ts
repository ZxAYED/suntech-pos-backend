import { Prisma } from '@prisma/client';

export const userPublicSelect = {
  id: true,
  publicId: true,
  fullName: true,
  email: true,
  phoneNumber: true,
  role: true,
  status: true,
  businessId: true,
  locationId: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof userPublicSelect;
}>;
