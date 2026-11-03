import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

export interface CategoryWithAnalytics {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  productsCount: number;
  activeSkus: number;
  totalUnits: number;
  inventoryValue: number;
  retailStockValue?: number;
  inventoryCostValue?: number;
  salesCount: number;
  salesRevenue: number;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    products: number;
  };
}

export type PresentedCategory = CategoryWithAnalytics;

const NAME_TAKEN = 'A category with that name already exists';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveBusinessId(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): string {
    return requireBusinessId(actor, requestedBusinessId);
  }

  async create(
    admin: AccessTokenPayload,
    dto: CreateCategoryDto,
  ): Promise<PresentedCategory> {
    const businessId = await this.resolveBusinessId(admin, dto.businessId);
    const name = dto.name.trim();
    const slug =
      dto.slug?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    await this.assertNameAvailable(businessId, name, slug);

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status === 'ACTIVE'
          : true;

    try {
      const created = await this.prisma.category.create({
        data: {
          businessId,
          name,
          slug,
          description: dto.description?.trim() || null,
          isActive,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        id: created.id,
        name: created.name,
        slug: created.slug || slug,
        description: created.description,
        isActive: created.isActive ?? true,
        status: created.isActive === false ? 'INACTIVE' : 'ACTIVE',
        productsCount: 0,
        activeSkus: 0,
        totalUnits: 0,
        inventoryValue: 0,
        salesCount: 0,
        salesRevenue: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        _count: {
          products: 0,
        },
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }
  }

  async list(
    admin: AccessTokenPayload,
    search?: string,
    locationId?: string,
    requestedBusinessId?: string,
    status?: string,
  ): Promise<PresentedCategory[]> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    const searchFilter = search?.trim()
      ? {
          OR: [
            {
              name: { contains: search.trim(), mode: 'insensitive' as const },
            },
            {
              description: {
                contains: search.trim(),
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {};

    const statusFilter = status
      ? status.toUpperCase() === 'ACTIVE'
        ? { isActive: true }
        : status.toUpperCase() === 'INACTIVE'
          ? { isActive: false }
          : {}
      : {};

    const categories = await this.prisma.category.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(admin.role === Role.CASHIER ? { isActive: true } : statusFilter),
        ...searchFilter,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        products: {
          where: { deletedAt: null },
          select: {
            id: true,
            variants: {
              where: { deletedAt: null },
              select: {
                id: true,
                stock: true,
                sellingPrice: true,
                costPrice: true,
                locationStocks: {
                  select: {
                    locationId: true,
                    stock: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const allVariantIds = categories.flatMap((c) =>
      c.products.flatMap((p) => p.variants.map((v) => v.id)),
    );

    const salesByVariant = new Map<
      string,
      { quantity: number; subtotal: number }
    >();

    if (allVariantIds.length > 0) {
      if (typeof this.prisma.orderLine?.groupBy === 'function') {
        const groups = await this.prisma.orderLine.groupBy({
          by: ['variantId'],
          where: {
            variantId: { in: allVariantIds },
            order: { status: OrderStatus.PAID },
          },
          _sum: {
            quantity: true,
            subtotal: true,
          },
        });
        for (const g of groups) {
          if (!g.variantId) continue;
          salesByVariant.set(g.variantId, {
            quantity: g._sum?.quantity ?? 0,
            subtotal: g._sum?.subtotal ?? 0,
          });
        }
      } else if (this.prisma.orderLine?.findMany) {
        const orderLines = await this.prisma.orderLine.findMany({
          where: {
            variantId: { in: allVariantIds },
            order: { status: OrderStatus.PAID },
          },
          select: {
            variantId: true,
            quantity: true,
            subtotal: true,
          },
        });

        for (const line of orderLines) {
          if (!line.variantId) continue;
          const current = salesByVariant.get(line.variantId) ?? {
            quantity: 0,
            subtotal: 0,
          };
          salesByVariant.set(line.variantId, {
            quantity: current.quantity + line.quantity,
            subtotal: current.subtotal + line.subtotal,
          });
        }
      }
    }

    const effectiveLocationId =
      admin.role === Role.CASHIER
        ? admin.locationId
        : locationId?.trim() || undefined;

    return categories.map((cat) => {
      const variants = cat.products.flatMap((p) => p.variants);
      const getVariantStock = (v: any) => {
        if (effectiveLocationId) {
          const match = (v.locationStocks ?? []).find(
            (ls: any) => ls.locationId === effectiveLocationId,
          );
          return match ? match.stock : 0;
        }
        return v.stock;
      };
      const totalUnits = variants.reduce(
        (sum, v) => sum + getVariantStock(v),
        0,
      );
      const inventoryValue = variants.reduce(
        (sum, v) => sum + getVariantStock(v) * v.sellingPrice,
        0,
      );
      const retailStockValue = inventoryValue;
      const inventoryCostValue = variants.reduce(
        (sum, v) =>
          sum +
          (v.costPrice !== null && v.costPrice !== undefined
            ? getVariantStock(v) * v.costPrice
            : 0),
        0,
      );
      const salesCount = variants.reduce(
        (sum, v) => sum + (salesByVariant.get(v.id)?.quantity ?? 0),
        0,
      );
      const salesRevenue = variants.reduce(
        (sum, v) => sum + (salesByVariant.get(v.id)?.subtotal ?? 0),
        0,
      );

      const defaultSlug = cat.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || defaultSlug,
        description: cat.description,
        isActive: (cat as any).isActive ?? true,
        status: (cat as any).isActive === false ? 'INACTIVE' : 'ACTIVE',
        productsCount: cat.products.length,
        activeSkus: variants.length,
        totalUnits,
        inventoryValue,
        retailStockValue,
        inventoryCostValue,
        salesCount,
        salesRevenue,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt,
        _count: {
          products: cat.products.length,
        },
      };
    });
  }

  async get(
    admin: AccessTokenPayload,
    categoryId: string,
    requestedBusinessId?: string,
  ): Promise<PresentedCategory> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);

    const cat = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        products: {
          where: { deletedAt: null },
          select: {
            id: true,
            variants: {
              where: { deletedAt: null },
              select: {
                id: true,
                stock: true,
                sellingPrice: true,
                costPrice: true,
              },
            },
          },
        },
      },
    });

    if (!cat) {
      throw new NotFoundException('Category not found');
    }

    const variants = cat.products.flatMap((p) => p.variants);
    const variantIds = variants.map((v) => v.id);

    let salesCount = 0;
    let salesRevenue = 0;

    if (variantIds.length > 0) {
      if (typeof this.prisma.orderLine?.aggregate === 'function') {
        const agg = await this.prisma.orderLine.aggregate({
          where: {
            variantId: { in: variantIds },
            order: { status: OrderStatus.PAID },
          },
          _sum: {
            quantity: true,
            subtotal: true,
          },
        });
        salesCount = agg._sum?.quantity ?? 0;
        salesRevenue = agg._sum?.subtotal ?? 0;
      } else if (this.prisma.orderLine?.findMany) {
        const orderLines = await this.prisma.orderLine.findMany({
          where: {
            variantId: { in: variantIds },
            order: { status: OrderStatus.PAID },
          },
          select: {
            quantity: true,
            subtotal: true,
          },
        });

        for (const line of orderLines) {
          salesCount += line.quantity;
          salesRevenue += line.subtotal;
        }
      }
    }

    const totalUnits = variants.reduce((sum, v) => sum + v.stock, 0);
    const inventoryValue = variants.reduce(
      (sum, v) => sum + v.stock * v.sellingPrice,
      0,
    );
    const retailStockValue = inventoryValue;
    const inventoryCostValue = variants.reduce(
      (sum, v) =>
        sum +
        (v.costPrice !== null && v.costPrice !== undefined
          ? v.stock * v.costPrice
          : 0),
      0,
    );

    const defaultSlug = cat.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return {
      id: cat.id,
      name: cat.name,
      slug: cat.slug || defaultSlug,
      description: cat.description,
      isActive: (cat as any).isActive ?? true,
      status: (cat as any).isActive === false ? 'INACTIVE' : 'ACTIVE',
      productsCount: cat.products.length,
      activeSkus: variants.length,
      totalUnits,
      inventoryValue,
      retailStockValue,
      inventoryCostValue,
      salesCount,
      salesRevenue,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
      _count: {
        products: cat.products.length,
      },
    };
  }

  async update(
    admin: AccessTokenPayload,
    categoryId: string,
    dto: UpdateCategoryDto,
    requestedBusinessId?: string,
  ): Promise<PresentedCategory> {
    const businessId = await this.resolveBusinessId(
      admin,
      requestedBusinessId || dto.businessId,
    );
    await this.findCategory(businessId, categoryId);
    const name = dto.name?.trim();
    const slug =
      dto.slug?.trim() ||
      (name
        ? name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : undefined);

    if (name || slug) {
      await this.assertNameAvailable(businessId, name ?? '', slug, categoryId);
    }

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status === 'ACTIVE'
          : undefined;

    try {
      const updated = await this.prisma.category.updateMany({
        where: { id: categoryId, businessId, deletedAt: null },
        data: {
          ...(name ? { name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      if (updated.count === 0) {
        throw new NotFoundException('Category not found');
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }

    return this.get(admin, categoryId, businessId);
  }

  async remove(
    admin: AccessTokenPayload,
    categoryId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({
        where: { id: categoryId, businessId, deletedAt: null },
        select: { id: true, name: true, slug: true },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }

      const activeProductsCount = await tx.product.count({
        where: { categoryId: category.id, businessId, deletedAt: null },
      });
      if (activeProductsCount > 0) {
        throw new ConflictException(
          `Cannot delete category "${category.name}" because it contains ${activeProductsCount} active product(s)`,
        );
      }

      // Include archived products/variants: refunds do not erase sales history.
      const historicalSales = await tx.orderLine.count({
        where: {
          variantId: { not: null },
          order: { location: { businessId } },
          OR: [
            // Link to the current product category, including archived rows.
            {
              variant: {
                is: { product: { is: { categoryId: category.id, businessId } } },
              },
            },
            // Order-time snapshot also covers a previously moved product.
            { categoryName: { equals: category.name, mode: 'insensitive' } },
          ],
        },
      });
      if (historicalSales > 0) {
        throw new ConflictException(
          `Cannot delete category "${category.name}" because it has sales history`,
        );
      }

      const deletedAt = new Date();
      await tx.category.update({
        where: { id: category.id },
        data: { isActive: false, deletedAt },
      });
      return { id: categoryId, deletedAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async findCategory(businessId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  private async assertNameAvailable(
    businessId: string,
    name: string,
    slug?: string | null,
    ignoreId?: string,
  ): Promise<void> {
    const orConditions: Prisma.CategoryWhereInput[] = [];
    if (name) {
      orConditions.push({ name: { equals: name, mode: 'insensitive' } });
    }
    if (slug) {
      orConditions.push({ slug: { equals: slug, mode: 'insensitive' } });
    }
    if (orConditions.length === 0) {
      return;
    }

    const existing = await this.prisma.category.findFirst({
      where: {
        businessId,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        OR: orConditions,
      },
      select: { id: true, deletedAt: true },
    });

    if (existing) {
      if (existing.deletedAt) {
        throw new ConflictException(
          `Category "${name}" already exists in archives. Archived categories cannot be reused without restoring the original record.`,
        );
      }
      throw new ConflictException(NAME_TAKEN);
    }
  }
}
