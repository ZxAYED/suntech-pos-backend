import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { PrismaService } from '../prisma/prisma.service';
import { OfflineContextQueryDto } from './offline-context.query';

@Injectable()
export class OfflineService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(
    actor: AccessTokenPayload,
    query: OfflineContextQueryDto = {},
  ) {
    const businessId =
      actor.role === Role.CASHIER ? actor.businessId : query.businessId;
    const locationId =
      actor.role === Role.CASHIER ? actor.locationId : query.locationId;
    if (!businessId || !locationId) {
      throw new ForbiddenException(
        'Offline checkout requires an assigned business and branch location',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const [user, business, location, categories] = await Promise.all([
          tx.user.findFirst({
            where: { id: actor.sub, deletedAt: null },
            select: {
              id: true,
              publicId: true,
              fullName: true,
              role: true,
              businessId: true,
              locationId: true,
            },
          }),
          tx.business.findFirst({
            where: {
              id: businessId,
              deletedAt: null,
              ...(actor.role === Role.ADMIN ? { ownerId: actor.sub } : {}),
            },
            select: { id: true, name: true, profileImageUrl: true },
          }),
          tx.location.findFirst({
            where: {
              id: locationId,
              businessId,
              deletedAt: null,
            },
            select: { id: true, name: true, address: true, businessId: true },
          }),
          tx.category.findMany({
            where: {
              businessId,
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              updatedAt: true,
              products: {
                where: { deletedAt: null, isActive: true },
                select: {
                  id: true,
                  name: true,
                  description: true,
                  customAttributes: true,
                  updatedAt: true,
                  variants: {
                    where: { deletedAt: null, isActive: true },
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      barcode: true,
                      sellingPrice: true,
                      profileImageUrl: true,
                      customAttributes: true,
                      updatedAt: true,
                      images: {
                        select: { url: true, sortOrder: true },
                        orderBy: { sortOrder: 'asc' },
                      },
                      locationStocks: {
                        where: { locationId },
                        select: { stock: true },
                        take: 1,
                      },
                    },
                    orderBy: { name: 'asc' },
                  },
                },
                orderBy: { name: 'asc' },
              },
            },
            orderBy: { name: 'asc' },
          }),
        ]);

        if (!user || !business || !location) {
          throw new NotFoundException(
            'Offline checkout context is no longer available',
          );
        }

        const generatedAt = new Date();
        return {
          serverTime: generatedAt.toISOString(),
          snapshotGeneratedAt: generatedAt.toISOString(),
          user: {
            ...user,
            businessId,
            locationId,
          },
          business,
          location,
          paymentMethods: Object.values(PaymentMethod),
          categories: categories.map((category) => ({
            ...category,
            products: category.products.map((product) => ({
              ...product,
              variants: product.variants.map(
                ({ locationStocks, ...variant }) => ({
                  ...variant,
                  stock: locationStocks[0]?.stock ?? 0,
                }),
              ),
            })),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
