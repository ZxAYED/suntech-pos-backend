import { Prisma } from '@prisma/client';

export const variantImageSelect = {
  id: true,
  url: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.VariantImageSelect;

export type PresentedVariantImage = Prisma.VariantImageGetPayload<{
  select: typeof variantImageSelect;
}>;
