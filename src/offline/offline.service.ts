import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { PrismaService } from '../prisma/prisma.service';
import { OfflineContextQueryDto } from './offline-context.query';
import { AccountStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { presentOrder, unifiedOrderSelect } from '../orders/order.service';

@Injectable()
export class OfflineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService?: ConfigService,
  ) {}

  /** One published snapshot covers EVERY sellable product, including uncategorized ones. */
  async bootstrapV2(
    actor: AccessTokenPayload,
    query: OfflineContextQueryDto & { deviceId: string },
  ) {
    const businessId =
      actor.role === Role.CASHIER ? actor.businessId : query.businessId;
    const locationId =
      actor.role === Role.CASHIER ? actor.locationId : query.locationId;
    if (
      !businessId ||
      !locationId ||
      (actor.role === Role.CASHIER &&
        ((query.businessId && query.businessId !== businessId) ||
          (query.locationId && query.locationId !== locationId)))
    )
      throw new ForbiddenException(
        'Offline snapshot scope must match the current operator and branch',
      );
    return this.prisma.$transaction(
      async (tx) => {
        const generatedAt = new Date().toISOString();
        const [
          user,
          business,
          location,
          categories,
          products,
          included,
          history,
        ] = await Promise.all([
          tx.user.findFirst({
            where: {
              id: actor.sub,
              deletedAt: null,
              status: AccountStatus.ACTIVE,
              role: actor.role,
            },
            select: {
              id: true,
              publicId: true,
              fullName: true,
              role: true,
              status: true,
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
            where: { id: locationId, businessId, deletedAt: null },
            select: { id: true, name: true, address: true, businessId: true },
          }),
          tx.category.findMany({
            where: { businessId, deletedAt: null, isActive: true },
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              updatedAt: true,
            },
            orderBy: { name: 'asc' },
          }),
          tx.product.findMany({
            where: { businessId, deletedAt: null, isActive: true },
            select: {
              id: true,
              name: true,
              description: true,
              categoryId: true,
              category: { select: { id: true, name: true } },
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
          }),
          // Complete original-device identity coverage prevents stock being subtracted twice
          // after more than 100 accepted sales, a lost acknowledgment, or backup restore.
          tx.order.findMany({
            where: {
              locationId,
              cashierId: actor.sub,
              deviceId: query.deviceId,
              clientOrderId: { not: null },
            },
            select: { clientOrderId: true },
          }),
          tx.order.findMany({
            where: { locationId, cashierId: actor.sub },
            select: unifiedOrderSelect,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: 100,
          }),
        ]);
        if (
          !user ||
          !business ||
          !location ||
          (actor.role === Role.CASHIER &&
            (user.businessId !== businessId || user.locationId !== locationId))
        )
          throw new ForbiddenException(
            'Offline snapshot permission is no longer available',
          );
        const flatProducts = products.map((product) => ({
          ...product,
          categoryName: product.category?.name ?? 'Uncategorized',
          variants: product.variants.map(({ locationStocks, ...variant }) => ({
            ...variant,
            stock: locationStocks[0]?.stock ?? 0,
          })),
        }));
        const rawSkew =
          this.configService?.get<number | string>(
            'OFFLINE_MAX_FUTURE_SKEW_SECONDS',
          ) ?? process.env.OFFLINE_MAX_FUTURE_SKEW_SECONDS;
        const parsedSkew =
          rawSkew === undefined || rawSkew === '' ? 300 : Number(rawSkew);
        return {
          serverTime: generatedAt,
          snapshotGeneratedAt: generatedAt,
          businessTimezone: 'Asia/Dhaka',
          maxFutureSkewSeconds:
            Number.isFinite(parsedSkew) && parsedSkew >= 0
              ? Math.floor(parsedSkew)
              : 300,
          user: { ...user, businessId, locationId },
          business,
          location,
          paymentMethods: Object.values(PaymentMethod),
          categories: categories.map((category) => ({
            ...category,
            products: flatProducts.filter(
              (product) => product.categoryId === category.id,
            ),
          })),
          products: flatProducts,
          acceptedClientOrderIds: included.map((order) => order.clientOrderId!),
          acceptedIdsComplete: true,
          history: history.map(presentOrder),
          manifest: {
            version: 2,
            snapshotId: randomUUID(),
            complete: true,
            scope: {
              userId: actor.sub,
              businessId,
              locationId,
              deviceId: query.deviceId,
            },
            counts: {
              categories: categories.length,
              products: flatProducts.length,
              variants: flatProducts.reduce(
                (sum, product) => sum + product.variants.length,
                0,
              ),
            },
            acceptedIdsComplete: true,
            history: {
              complete: false,
              limit: 100,
              coverage: 'RECENT_ORIGINAL_OPERATOR',
            },
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

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
        const rawSkew =
          this.configService?.get<number | string>(
            'OFFLINE_MAX_FUTURE_SKEW_SECONDS',
          ) ?? process.env.OFFLINE_MAX_FUTURE_SKEW_SECONDS;
        const parsedSkew =
          typeof rawSkew === 'number'
            ? rawSkew
            : parseInt(String(rawSkew ?? ''), 10);
        const maxFutureSkewSeconds =
          Number.isFinite(parsedSkew) && parsedSkew >= 0
            ? Math.floor(parsedSkew)
            : 300;
        return {
          serverTime: generatedAt.toISOString(),
          snapshotGeneratedAt: generatedAt.toISOString(),
          businessTimezone: 'Asia/Dhaka',
          maxFutureSkewSeconds,
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
