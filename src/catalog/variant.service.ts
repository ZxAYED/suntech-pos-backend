import {
  BadRequestException,
  ConflictException,
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
  isActive: true,
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
  isActive: boolean;
  status: 'ACTIVE' | 'INACTIVE';
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
    const match = locationStocks.find(
      (ls) => ls.locationId === effectiveLocationId,
    );
    stock = match ? match.stock : 0;
  }

  return {
    ...variant,
    stock,
    isActive: (variant as any).isActive !== false,
    status: (variant as any).isActive === false ? 'INACTIVE' : 'ACTIVE',
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

    const targetLocationId = dto.locationId?.trim();
    if (dto.stock !== undefined && dto.stock !== null && dto.stock > 0) {
      if (!targetLocationId) {
        throw new BadRequestException(
          'Branch locationId is required to set initial variant stock',
        );
      }
      await this.assertLocation(businessId, targetLocationId);
    }

    const attempts = requestedSku ? 1 : SKU_ATTEMPTS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const sku = requestedSku ?? createSku();

      try {
        const executeCreate = async (tx: any) => {
          const created = await tx.variant.create({
            data: {
              businessId,
              productId: dto.productId,
              name: dto.name.trim(),
              sku,
              barcode,
              sellingPrice: dto.sellingPrice,
              costPrice: dto.costPrice ?? null,
              stock: dto.stock ?? 0,
              isActive:
                dto.isActive !== undefined
                  ? dto.isActive
                  : dto.status !== undefined
                    ? dto.status === 'ACTIVE'
                    : true,
            },
            select: variantSelect,
          });

          if (
            dto.stock !== undefined &&
            dto.stock !== null &&
            dto.stock > 0 &&
            targetLocationId &&
            tx.locationStock?.upsert
          ) {
            await tx.locationStock.upsert({
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

            if (tx.locationStock.aggregate) {
              const agg = await tx.locationStock.aggregate({
                where: { variantId: created.id },
                _sum: { stock: true },
              });
              const totalStock = agg._sum.stock ?? dto.stock;
              await tx.variant.update({
                where: { id: created.id },
                data: { stock: totalStock },
              });
              created.stock = totalStock;
            }

            if (tx.stockTransaction?.create) {
              await tx.stockTransaction.create({
                data: {
                  variantId: created.id,
                  locationId: targetLocationId,
                  type: StockTransactionType.RESTOCK,
                  quantity: dto.stock,
                  notes: 'Initial variant stock setup',
                },
              });
            }
          }

          // INVARIANT: If this newly created variant is active, unlock the parent product
          // from draft to active.
          if (created.isActive) {
            const parentProduct = await tx.product.findFirst({
              where: { id: dto.productId, businessId, deletedAt: null },
              select: { id: true, isActive: true },
            });
            if (parentProduct && !parentProduct.isActive) {
              await tx.product.update({
                where: { id: parentProduct.id },
                data: { isActive: true },
              });
            }
          }

          return created;
        };

        const created = this.prisma.$transaction
          ? await this.prisma.$transaction(executeCreate)
          : await executeCreate(this.prisma);

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

    const statusFilter = query?.status
      ? query.status.toUpperCase() === 'ACTIVE'
        ? { isActive: true }
        : query.status.toUpperCase() === 'INACTIVE'
          ? { isActive: false }
          : {}
      : {};

    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : query?.locationId?.trim() || undefined;

    const lowStockFilter = isLowStock
      ? effectiveLocationId
        ? {
            OR: [
              {
                locationStocks: {
                  some: {
                    locationId: effectiveLocationId,
                    stock: { lte: LOW_STOCK_THRESHOLD },
                  },
                },
              },
              {
                locationStocks: {
                  none: {
                    locationId: effectiveLocationId,
                  },
                },
              },
            ],
          }
        : { stock: { lte: LOW_STOCK_THRESHOLD } }
      : {};

    const page = query?.page ? Math.max(1, Number(query.page)) : undefined;
    const limit = query?.limit ? Math.max(1, Number(query.limit)) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const variants = await this.prisma.variant.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(actor.role === Role.CASHIER ? { isActive: true } : statusFilter),
        product: {
          businessId,
          deletedAt: null,
          ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
          ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        },
        ...(query?.productId ? { productId: query.productId } : {}),
        ...lowStockFilter,
        ...searchFilter,
      },
      select: variantSelect,
      orderBy: { name: 'asc' },
      ...(skip !== undefined ? { skip } : {}),
      ...(take !== undefined ? { take } : {}),
    });

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
      if (dto.productId !== current.productId) {
        const sold = await this.prisma.orderLine.count({
          where: { variantId, order: { location: { businessId } } },
        });
        if (sold > 0) {
          throw new ConflictException(
            'Cannot move a variant with sales history to another product',
          );
        }
      }
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

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status === 'ACTIVE'
          : undefined;

    const targetLocationId = dto.locationId?.trim();
    if (dto.stock !== undefined && dto.stock !== null) {
      if (!targetLocationId) {
        throw new BadRequestException(
          'Branch locationId is required to set variant stock',
        );
      }
      await this.assertLocation(businessId, targetLocationId);
    }

    try {
      const executeUpdate = async (tx: any) => {
        const updated = await tx.variant.updateMany({
          where: { id: current.id, businessId, deletedAt: null },
          data: {
            ...(dto.productId ? { productId: dto.productId } : {}),
            ...(dto.name ? { name: dto.name.trim() } : {}),
            ...(sku ? { sku } : {}),
            ...(barcode !== undefined ? { barcode } : {}),
            ...(dto.sellingPrice !== undefined
              ? { sellingPrice: dto.sellingPrice }
              : {}),
            ...(dto.costPrice !== undefined
              ? { costPrice: dto.costPrice }
              : {}),
            ...(isActive !== undefined ? { isActive } : {}),
          },
        });

        if (updated.count === 0) {
          throw new NotFoundException('Variant not found');
        }

        if (
          dto.stock !== undefined &&
          dto.stock !== null &&
          targetLocationId &&
          tx.locationStock?.upsert
        ) {
          const locStockRow = tx.locationStock?.findUnique
            ? await tx.locationStock.findUnique({
                where: {
                  locationId_variantId: {
                    locationId: targetLocationId,
                    variantId: current.id,
                  },
                },
              })
            : null;
          const branchBaseline = locStockRow?.stock ?? 0;
          // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode.
          const newBranchStock = dto.stock;
          const branchDelta = Math.abs(newBranchStock - branchBaseline);

          await tx.locationStock.upsert({
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
              stock: newBranchStock,
            },
            update: {
              stock: newBranchStock,
            },
          });

          if (tx.locationStock.aggregate) {
            const agg = await tx.locationStock.aggregate({
              where: { variantId: current.id },
              _sum: { stock: true },
            });
            const totalStock = agg._sum.stock ?? newBranchStock;
            await tx.variant.update({
              where: { id: current.id },
              data: { stock: totalStock },
            });
          }

          if (branchDelta > 0) {
            const deltaSign = newBranchStock >= branchBaseline ? '+' : '-';
            await tx.stockTransaction.create({
              data: {
                variantId: current.id,
                locationId: targetLocationId,
                type: StockTransactionType.MANUAL_ADJUSTMENT,
                quantity: branchDelta,
                notes: `Variant metadata stock update: ${branchBaseline} -> ${newBranchStock} (${deltaSign}${branchDelta})`,
              },
            });
          }
        }

        // INVARIANT: Synchronize parent product status with active variant availability
        if (isActive === false) {
          const otherActive = await tx.variant.count({
            where: {
              productId: current.productId,
              businessId,
              id: { not: current.id },
              isActive: true,
              deletedAt: null,
            },
          });
          if (otherActive === 0) {
            await tx.product.update({
              where: { id: current.productId },
              data: { isActive: false },
            });
          }
        } else if (isActive === true) {
          const parent = await tx.product.findFirst({
            where: { id: current.productId, businessId, deletedAt: null },
            select: { id: true, isActive: true },
          });
          if (parent && !parent.isActive) {
            await tx.product.update({
              where: { id: parent.id },
              data: { isActive: true },
            });
          }
        }
      };

      if (this.prisma.$transaction) {
        await this.prisma.$transaction(executeUpdate, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } else {
        await executeUpdate(this.prisma);
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

    const targetLocationId =
      actor.role === Role.CASHIER ? actor.locationId : dto.locationId?.trim();

    if (!targetLocationId) {
      throw new BadRequestException(
        actor.role === Role.CASHIER
          ? 'Cashier account must be assigned to an active business and branch location'
          : 'Branch locationId is required for stock adjustment',
      );
    }

    await this.assertLocation(businessId, targetLocationId);

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

    const executeStockMutation = async (tx: any) => {
      // 1. Fetch fresh baseline inside transaction (O05)
      let insideBaseline = currentBaseline;
      if (targetLocationId && tx.locationStock?.findUnique) {
        const row = await tx.locationStock.findUnique({
          where: {
            locationId_variantId: {
              locationId: targetLocationId,
              variantId: current.id,
            },
          },
        });
        if (row !== null && row !== undefined) {
          insideBaseline = row.stock ?? 0;
        }
      }

      let newLocationStock: number;
      let txType: StockTransactionType;
      let txQty: number;

      if (operation === StockOperation.DEDUCT) {
        // Never infer SALE from notes (O25)
        txType = StockTransactionType.MANUAL_ADJUSTMENT;
        txQty = changeQty;

        // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode.
        newLocationStock = insideBaseline - changeQty;
      } else if (operation === StockOperation.ADD) {
        txType = StockTransactionType.RESTOCK;
        txQty = changeQty;

        newLocationStock = insideBaseline + changeQty;
      } else {
        // SET: calculate delta against branch baseline (O10)
        txType = StockTransactionType.MANUAL_ADJUSTMENT;
        txQty = Math.abs(changeQty - insideBaseline);

        // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode.
        newLocationStock = changeQty;
      }

      let newGlobalStock = newLocationStock;

      // 1. Update location stock if targetLocationId is available
      if (targetLocationId && tx.locationStock?.upsert) {
        await tx.locationStock.upsert({
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

        if (tx.locationStock.aggregate) {
          const agg = await tx.locationStock.aggregate({
            where: { variantId: current.id },
            _sum: { stock: true },
          });
          newGlobalStock = agg?._sum?.stock ?? newLocationStock;
        }
      }

      // 2. Update variant global aggregate stock
      if (tx.variant?.update) {
        await tx.variant.update({
          where: { id: current.id },
          data: { stock: newGlobalStock },
        });
      }

      // 3. Create stock transaction record
      if (txQty > 0) {
        await tx.stockTransaction.create({
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
    };

    if (this.prisma.$transaction) {
      await this.prisma.$transaction(executeStockMutation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } else {
      await executeStockMutation(this.prisma);
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
      select: {
        id: true,
        sku: true,
        barcode: true,
        stock: true,
        productId: true,
      },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    // Refunds still retain sales history. Archive only unused variants.
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const soldLines = await tx.orderLine.count({
        where: { variantId: variant.id },
      });
      if (soldLines > 0) {
        throw new ConflictException(
          `Cannot delete variant "${variant.sku}" because it has sales history`,
        );
      }
      const branchStock = await tx.locationStock.findFirst({
        where: { variantId: variant.id, stock: { not: 0 } },
        select: { id: true },
      });
      if (variant.stock !== 0 || branchStock) {
        throw new ConflictException(
          `Cannot delete variant "${variant.sku}" while it has non-zero inventory`,
        );
      }
      await tx.variant.update({
        where: { id: variant.id },
        data: { isActive: false, deletedAt },
      });

      // INVARIANT: If this was the last active variant, deactivate the parent product.
      const remainingActive = await tx.variant.count({
        where: {
          productId: variant.productId,
          businessId,
          isActive: true,
          deletedAt: null,
        },
      });
      if (remainingActive === 0) {
        await tx.product.update({
          where: { id: variant.productId },
          data: { isActive: false },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
      const anyLoc = await this.prisma.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (anyLoc && anyLoc.businessId && anyLoc.businessId !== businessId) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
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
      matches.push({ sku: { equals: codes.sku, mode: 'insensitive' } });
    }

    if (codes.barcode) {
      matches.push({ barcode: { equals: codes.barcode, mode: 'insensitive' } });
    }

    if (matches.length === 0) {
      return;
    }

    const existing = await this.prisma.variant.findFirst({
      where: {
        businessId,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        OR: matches,
      },
      select: { id: true, deletedAt: true },
    });

    if (existing) {
      if (existing.deletedAt) {
        throw new ConflictException(
          'SKU or barcode is already associated with an archived variant. Archived codes cannot be reused without restoring the original record.',
        );
      }
      throw new ConflictException(CODE_TAKEN);
    }
  }
}
