import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
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
  status: 'ACTIVE' | 'INACTIVE';
  productsCount: number;
  activeSkus: number;
  totalUnits: number;
  inventoryValue: number;
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

  async create(
    admin: AccessTokenPayload,
    dto: CreateCategoryDto,
  ): Promise<PresentedCategory> {
    const businessId = requireBusinessId(admin);
    const name = dto.name.trim();
    await this.assertNameAvailable(businessId, name);

    const slug =
      dto.slug?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    try {
      const created = await this.prisma.category.create({
        data: {
          businessId,
          name,
          slug,
          description: dto.description?.trim() || null,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        id: created.id,
        name: created.name,
        slug: created.slug || slug,
        description: created.description,
        status: 'ACTIVE',
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
  ): Promise<PresentedCategory[]> {
    const businessId = requireBusinessId(admin);
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

    const categories = await this.prisma.category.findMany({
      where: { businessId, deletedAt: null, ...searchFilter },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
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

    return categories.map((cat) => {
      const variants = cat.products.flatMap((p) => p.variants);
      const totalUnits = variants.reduce((sum, v) => sum + v.stock, 0);
      const inventoryValue = variants.reduce(
        (sum, v) => sum + v.stock * v.sellingPrice,
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
        status: 'ACTIVE',
        productsCount: cat.products.length,
        activeSkus: variants.length,
        totalUnits,
        inventoryValue,
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
  ): Promise<PresentedCategory> {
    const businessId = requireBusinessId(admin);

    const cat = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
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

    const totalUnits = variants.reduce((sum, v) => sum + v.stock, 0);
    const inventoryValue = variants.reduce(
      (sum, v) => sum + v.stock * v.sellingPrice,
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
      status: 'ACTIVE',
      productsCount: cat.products.length,
      activeSkus: variants.length,
      totalUnits,
      inventoryValue,
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
  ): Promise<PresentedCategory> {
    const businessId = requireBusinessId(admin);
    await this.findCategory(businessId, categoryId);
    const name = dto.name?.trim();

    if (name) {
      await this.assertNameAvailable(businessId, name, categoryId);
    }

    const slug =
      dto.slug?.trim() ||
      (name
        ? name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : undefined);

    try {
      const updated = await this.prisma.category.updateMany({
        where: { id: categoryId, businessId, deletedAt: null },
        data: {
          ...(name ? { name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
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

    return this.get(admin, categoryId);
  }

  async remove(
    admin: AccessTokenPayload,
    categoryId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(admin);
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const timestamp = Date.now();
    const deletedAt = new Date();
    const suffixedName = `${category.name}__del_${timestamp}`;
    const suffixedSlug = category.slug
      ? `${category.slug}__del_${timestamp}`
      : null;

    await this.prisma.category.update({
      where: { id: category.id },
      data: {
        name: suffixedName,
        slug: suffixedSlug,
        deletedAt,
      },
    });

    return { id: categoryId, deletedAt };
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
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: {
        businessId,
        name,
        deletedAt: null,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(NAME_TAKEN);
    }
  }
}
