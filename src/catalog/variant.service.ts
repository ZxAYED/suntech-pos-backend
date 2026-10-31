import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, StockTransactionType } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { PrismaService } from '../prisma/prisma.service';
import { requireBusinessId } from '../hr/require-business-id';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants.query';
import {
  StockOperation,
  UpdateVariantStockDto,
} from './dto/update-variant-stock.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { createSku } from './sku';

const variantSelect = {
  id: true,
  productId: true,
  name: true,
  sku: true,
  barcode: true,
  sellingPrice: true,
  costPrice: true,
  stock: true,
  profileImageUrl: true,
  profileImagePublicId: true,
  profileImageKey: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: { id: true, url: true, publicId: true, key: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  product: {
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
  },
  locationStocks: {
    select: {
      id: true,
      locationId: true,
      stock: true,
      location: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.VariantSelect;

type VariantRow = Prisma.VariantGetPayload<{
  select: typeof variantSelect;
}>;

export type PresentedVariant = VariantRow & {
  productName: string;
  categoryId: string | null;
  categoryName: string;
  price: number;
  marginPercent: number | null;
};

const CODE_TAKEN = 'A variant with that SKU or barcode already exists';
const SKU_ATTEMPTS = 3;
const LOW_STOCK_THRESHOLD = 5;

export function presentVariant(
  variant: VariantRow,
  effectiveLocationId?: string | null,
): PresentedVariant {
  const sellingPrice = variant.sellingPrice ?? 0;
  const costPrice = variant.costPrice;
  const marginPercent =
    sellingPrice > 0 && costPrice != null
      ? Math.round(((sellingPrice - costPrice) / sellingPrice) * 100)
      : null;

  const locationStocks = (variant.locationStocks ?? []).map((ls: any) => ({
    ...ls,
    locationName: ls.location?.name ?? ls.locationName ?? null,
  }));

  let stock = variant.stock;
  if (effectiveLocationId) {
    if (locationStocks.length > 0) {
      const match = locationStocks.find(
        (ls) => ls.locationId === effectiveLocationId,
      );
      stock = match ? match.stock : 0;
    }
  }

  return {
    ...variant,
    stock,
    locationStocks,
    productName: variant.product?.name ?? '',
    categoryId:
      variant.product?.category?.id ?? variant.product?.categoryId ?? null,
    categoryName: variant.product?.category?.name ?? 'Uncategorized',
    price: sellingPrice,
    marginPercent,
  };
}

@Injectable()
export class VariantService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveBusinessId(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): string {
    return requireBusinessId(actor, requestedBusinessId);
  }

  async create(
    admin: AccessTokenPayload,
    dto: CreateVariantDto,
  ): Promise<PresentedVariant> {
    const businessId = await this.resolveBusinessId(admin, dto.businessId);
    await this.assertProduct(businessId, dto.productId);
    if (dto.locationId?.trim()) {
      await this.assertLocation(businessId, dto.locationId.trim());
    }
    const requestedSku = dto.sku?.trim();
    const barcode = dto.barcode?.trim() || null;

    if (requestedSku || barcode) {
      await this.assertCodesAvailable(businessId, {
        sku: requestedSku,
        barcode,
      });
    }

    const attempts = requestedSku ? 1 : SKU_ATTEMPTS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const sku = requestedSku ?? createSku();

      try {
        const created = await this.prisma.variant.create({
          data: {
            businessId,
            productId: dto.productId,
            name: dto.name.trim(),
            sku,
            barcode,
            sellingPrice: dto.sellingPrice,
            costPrice: dto.costPrice ?? null,
            stock: dto.stock ?? 0,
          },
          select: variantSelect,
        });

        if (dto.stock !== undefined && dto.stock !== null) {
          let targetLocationId = dto.locationId?.trim();
          if (!targetLocationId && this.prisma.location?.findFirst) {
            const loc = await this.prisma.location.findFirst({
              where: { businessId, deletedAt: null },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
            });
            if (loc) {
              targetLocationId = loc.id;
            }
          }

          if (targetLocationId && this.prisma.locationStock?.upsert) {
            await this.prisma.locationStock.upsert({
              where: {
                locationId_variantId: {
                  locationId: targetLocationId,
                  variantId: created.id,
                },
              },
              create: {
                businessId,
                locationId: targetLocationId,
                variantId: created.id,
                stock: dto.stock,
              },
              update: {
                stock: dto.stock,
              },
            });

            if (this.prisma.locationStock.aggregate) {
              const agg = await this.prisma.locationStock.aggregate({
                where: { variantId: created.id },
                _sum: { stock: true },
              });
              const totalStock = agg._sum.stock ?? dto.stock;
              await this.prisma.variant.update({
                where: { id: created.id },
                data: { stock: totalStock },
              });
              created.stock = totalStock;
            }
          }
        }

        return presentVariant(created, dto.locationId);
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        if (!requestedSku && attempt < attempts) {
          continue;
        }

        throw new ConflictException(CODE_TAKEN);
      }
    }

    throw new ConflictException(CODE_TAKEN);
  }

  async list(
    actor: AccessTokenPayload,
    query?: ListVariantsQueryDto,
  ): Promise<PresentedVariant[]> {
    const businessId = await this.resolveBusinessId(actor, query?.businessId);
    const isLowStock = query?.lowStockOnly === 'true';
    const search = query?.search?.trim();

    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { sku: { contains: search, mode: 'insensitive' as const } },
            { barcode: { contains: search, mode: 'insensitive' as const } },
            {
              product: {
                name: { contains: search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {};

    const variants = await this.prisma.variant.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
        product: {
          businessId,
          deletedAt: null,
          ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
          ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        },
        ...(query?.productId ? { productId: query.productId } : {}),
        ...(isLowStock ? { stock: { lte: LOW_STOCK_THRESHOLD } } : {}),
        ...searchFilter,
      },
      select: variantSelect,
      orderBy: { name: 'asc' },
    });

    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : query?.locationId?.trim() || undefined;

    return variants.map((v) => presentVariant(v, effectiveLocationId));
  }

  async get(
    actor: AccessTokenPayload,
    variantId: string,
    requestedBusinessId?: string,
    requestedLocationId?: string,
  ): Promise<PresentedVariant> {
    const businessId = await this.resolveBusinessId(actor, requestedBusinessId);
    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : requestedLocationId?.trim() || undefined;
    return this.findVariant(businessId, variantId, effectiveLocationId);
  }

  async update(
    admin: AccessTokenPayload,
    variantId: string,
    dto: UpdateVariantDto,
    requestedBusinessId?: string,
  ): Promise<PresentedVariant> {
    const businessId = await this.resolveBusinessId(
      admin,
      requestedBusinessId || dto.businessId,
    );
    const current = await this.findVariant(businessId, variantId);

    if (dto.locationId?.trim()) {
      await this.assertLocation(businessId, dto.locationId.trim());
    }

    if (dto.productId) {
      await this.assertProduct(businessId, dto.productId);
    }

    const sku = dto.sku?.trim();
    const barcode =
      dto.barcode === undefined ? undefined : dto.barcode?.trim() || null;

    if (sku || barcode) {
      await this.assertCodesAvailable(
        businessId,
        { sku, barcode: barcode ?? undefined },
        variantId,
      );
    }

    try {
      const updated = await this.prisma.variant.updateMany({
        where: { id: current.id, businessId, deletedAt: null },
        data: {
          ...(dto.productId ? { productId: dto.productId } : {}),
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(sku ? { sku } : {}),
          ...(barcode !== undefined ? { barcode } : {}),
          ...(dto.sellingPrice !== undefined
            ? { sellingPrice: dto.sellingPrice }
            : {}),
          ...(dto.costPrice !== undefined ? { costPrice: dto.costPrice } : {}),
          ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      if (updated.count === 0) {
        throw new NotFoundException('Variant not found');
      }

      if (dto.stock !== undefined && dto.stock !== null) {
        let targetLocationId = dto.locationId?.trim();
        if (!targetLocationId && this.prisma.location?.findFirst) {
          const loc = await this.prisma.location.findFirst({
            where: { businessId, deletedAt: null },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (loc) {
            targetLocationId = loc.id;
          }
        }

        if (targetLocationId && this.prisma.locationStock?.upsert) {
          await this.prisma.locationStock.upsert({
            where: {
              locationId_variantId: {
                locationId: targetLocationId,
                variantId: current.id,
              },
            },
            create: {
              businessId,
              locationId: targetLocationId,
              variantId: current.id,
              stock: dto.stock,
            },
            update: {
              stock: dto.stock,
            },
          });

          if (this.prisma.locationStock.aggregate) {
            const agg = await this.prisma.locationStock.aggregate({
              where: { variantId: current.id },
              _sum: { stock: true },
            });
            const totalStock = agg._sum.stock ?? dto.stock;
            await this.prisma.variant.update({
              where: { id: current.id },
              data: { stock: totalStock },
            });
          }
        }
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(CODE_TAKEN);
      }

      throw error;
    }

    return this.findVariant(businessId, variantId, dto.locationId);
  }

  async updateStock(
    actor: AccessTokenPayload,
    variantId: string,
    dto: UpdateVariantStockDto,
    requestedBusinessId?: string,
  ): Promise<PresentedVariant> {
    const businessId = await this.resolveBusinessId(
      actor,
      requestedBusinessId || dto.businessId,
    );

    let targetLocationId =
      actor.role === Role.CASHIER ? actor.locationId : dto.locationId;

    if (actor.role === Role.CASHIER && !targetLocationId) {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }

    if (!targetLocationId && this.prisma.location?.findFirst) {
      const loc = await this.prisma.location.findFirst({
        where: { businessId, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (loc) {
        targetLocationId = loc.id;
      }
    }

    if (targetLocationId) {
      await this.assertLocation(businessId, targetLocationId);
    }

    const current = await this.prisma.variant.findFirst({
      where: { id: variantId, ...this.visibleWhere(businessId) },
      select: {
        id: true,
        name: true,
        stock: true,
        locationStocks: targetLocationId
          ? {
              where: { locationId: targetLocationId },
              select: { stock: true },
            }
          : false,
      },
    });

    if (!current) {
      throw new NotFoundException('Variant not found');
    }

    const existingLocStock = current.locationStocks?.[0]?.stock;
    // A branch without a LocationStock row starts at zero. Using the global
    // aggregate here would duplicate stock from other branches.
    const currentBaseline = targetLocationId
      ? (existingLocStock ?? 0)
      : current.stock;

    let operation = dto.operation ?? StockOperation.DEDUCT;
    let changeQty = 0;

    if (dto.stock !== undefined && dto.stock !== null) {
      operation = StockOperation.SET;
      changeQty = dto.stock;
    } else if (dto.delta !== undefined && dto.delta !== null) {
      if (dto.delta < 0) {
        operation = StockOperation.DEDUCT;
        changeQty = Math.abs(dto.delta);
      } else {
        operation = StockOperation.ADD;
        changeQty = dto.delta;
      }
    } else if (dto.quantity !== undefined && dto.quantity !== null) {
      if (dto.quantity < 0) {
        operation = StockOperation.DEDUCT;
        changeQty = Math.abs(dto.quantity);
      } else {
        changeQty = dto.quantity;
      }
    } else {
      throw new BadRequestException(
        'Provide quantity, delta, or stock to update',
      );
    }

    let newLocationStock: number;
    let newGlobalStock: number;
    let txType: StockTransactionType;
    let txQty: number;

    if (operation === StockOperation.DEDUCT) {
      txType = StockTransactionType.SALE;
      txQty = changeQty;

      if (!dto.allowNegative && currentBaseline < changeQty) {
        throw new BadRequestException(
          `Insufficient stock for "${current.name}". Available: ${currentBaseline}, Requested deduction: ${changeQty}`,
        );
      }

      newLocationStock = dto.allowNegative
        ? currentBaseline - changeQty
        : Math.max(0, currentBaseline - changeQty);
      newGlobalStock = dto.allowNegative
        ? current.stock - changeQty
        : Math.max(0, current.stock - changeQty);
    } else if (operation === StockOperation.ADD) {
      txType = StockTransactionType.RESTOCK;
      txQty = changeQty;

      newLocationStock = currentBaseline + changeQty;
      newGlobalStock = current.stock + changeQty;
    } else {
      // SET
      txType = StockTransactionType.MANUAL_ADJUSTMENT;
      txQty = Math.abs(changeQty - currentBaseline);

      newLocationStock = Math.max(0, changeQty);
      newGlobalStock = Math.max(0, changeQty);
    }

    // 1. Update location stock if targetLocationId is available
    if (targetLocationId && this.prisma.locationStock?.upsert) {
      await this.prisma.locationStock.upsert({
        where: {
          locationId_variantId: {
            locationId: targetLocationId,
            variantId: current.id,
          },
        },
        create: {
          businessId,
          locationId: targetLocationId,
          variantId: current.id,
          stock: newLocationStock,
        },
        update: {
          stock: newLocationStock,
        },
      });

      if (this.prisma.locationStock.aggregate) {
        const agg = await this.prisma.locationStock.aggregate({
          where: { variantId: current.id },
          _sum: { stock: true },
        });
        newGlobalStock = agg?._sum?.stock ?? newLocationStock;
      }
    }

    // 2. Update variant global aggregate stock
    await this.prisma.variant.update({
      where: { id: current.id },
      data: { stock: newGlobalStock },
    });

    // 3. Create stock transaction record
    if (this.prisma.stockTransaction?.create && txQty > 0) {
      await this.prisma.stockTransaction.create({
        data: {
          variantId: current.id,
          locationId: targetLocationId ?? null,
          type: txType,
          quantity: txQty,
          notes:
            dto.notes?.trim() ||
            `Inventory stock adjustment (${operation} ${txQty})`,
        },
      });
    }

    return this.findVariant(businessId, current.id, targetLocationId);
  }

  async remove(
    admin: AccessTokenPayload,
    variantId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, businessId, deletedAt: null },
      select: { id: true, sku: true, barcode: true },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    const timestamp = Date.now();
    const deletedAt = new Date();
    const suffixedSku = `${variant.sku}__del_${timestamp}`;
    const suffixedBarcode = variant.barcode
      ? `${variant.barcode}__del_${timestamp}`
      : null;

    await this.prisma.variant.update({
      where: { id: variant.id },
      data: {
        sku: suffixedSku,
        barcode: suffixedBarcode,
        deletedAt,
      },
    });

    return { id: variantId, deletedAt };
  }

  private visibleWhere(businessId: string): Prisma.VariantWhereInput {
    return {
      businessId,
      deletedAt: null,
      product: { businessId, deletedAt: null },
    };
  }

  private async findVariant(
    businessId: string,
    variantId: string,
    effectiveLocationId?: string | null,
  ) {
    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, ...this.visibleWhere(businessId) },
      select: variantSelect,
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    return presentVariant(variant, effectiveLocationId);
  }

  private async assertProduct(
    businessId: string,
    productId: string,
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private async assertLocation(
    businessId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!location) {
      throw new NotFoundException('Branch location not found');
    }
  }

  private async assertCodesAvailable(
    businessId: string,
    codes: { sku?: string; barcode?: string | null },
    ignoreId?: string,
  ): Promise<void> {
    const matches: Prisma.VariantWhereInput[] = [];

    if (codes.sku) {
      matches.push({ sku: codes.sku });
    }

    if (codes.barcode) {
      matches.push({ barcode: codes.barcode });
    }

    if (matches.length === 0) {
      return;
    }

    const existing = await this.prisma.variant.findFirst({
      where: {
        businessId,
        deletedAt: null,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        OR: matches,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(CODE_TAKEN);
    }
  }
}
