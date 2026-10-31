import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { normalizeCustomAttributes } from './dto/custom-attribute.dto';
import { ListProductsQueryDto } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';

const variantSelect = {
  id: true,
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
  customAttributes: true,
  locationStocks: {
    select: {
      locationId: true,
      stock: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.VariantSelect;

const productSelect = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
  isActive: true,
  customAttributes: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, deletedAt: true },
  },
  variants: {
    where: { deletedAt: null },
    select: variantSelect,
    orderBy: { name: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export const productListItemSelect = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
  isActive: true,
  customAttributes: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, deletedAt: true },
  },
  _count: {
    select: {
      variants: {
        where: { deletedAt: null },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductListItemRow = Prisma.ProductGetPayload<{
  select: typeof productListItemSelect;
}>;

export type PresentedLocationStock = {
  locationId: string;
  locationName: string | null;
  stock: number;
  location?: { id: string; name: string } | null;
};

export type PresentedVariant = Omit<
  ProductRow['variants'][number],
  'locationStocks'
> & {
  locationStocks: PresentedLocationStock[];
};

export type PresentedProduct = Omit<ProductRow, 'category' | 'variants'> & {
  category: { id: string; name: string } | null;
  variants: PresentedVariant[];
  status: 'ACTIVE' | 'INACTIVE';
};

export type PresentedProductListItem = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  isActive: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  _count: {
    variants: number;
  };
  variantsCount?: number;
  customAttributes?: any;
  createdAt: Date;
  updatedAt: Date;
};

export function presentProductListItem(
  product: ProductListItemRow,
): PresentedProductListItem {
  const category =
    product.category && !product.category.deletedAt
      ? { id: product.category.id, name: product.category.name }
      : null;

  const variantsCount = product._count?.variants ?? 0;

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category,
    isActive: product.isActive,
    status: product.isActive === false ? 'INACTIVE' : 'ACTIVE',
    _count: {
      variants: variantsCount,
    },
    variantsCount,
    ...(product.customAttributes
      ? { customAttributes: product.customAttributes }
      : {}),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

const NAME_TAKEN = 'A product with that name already exists';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveBusinessId(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): string {
    return requireBusinessId(actor, requestedBusinessId);
  }

  async create(
    admin: AccessTokenPayload,
    dto: CreateProductDto,
  ): Promise<PresentedProduct> {
    const businessId = await this.resolveBusinessId(admin, dto.businessId);
    const name = dto.name.trim();
    await this.assertNameAvailable(businessId, name);

    if (dto.categoryId) {
      await this.assertCategory(businessId, dto.categoryId);
    }

    const rawAttrs =
      dto.customAttributes ??
      dto.customFields ??
      dto.attributes ??
      dto.attachments;
    const customAttributes = normalizeCustomAttributes(rawAttrs);

    // Check if product was previously soft-deleted
    const softDeleted = await this.prisma.product.findFirst({
      where: {
        businessId,
        deletedAt: { not: null },
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { name: { startsWith: `${name}__del_`, mode: 'insensitive' } },
        ],
      },
      orderBy: { deletedAt: 'desc' },
    });

    if (softDeleted) {
      const restored = await this.prisma.product.update({
        where: { id: softDeleted.id },
        data: {
          name,
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
          customAttributes:
            (customAttributes as unknown as Prisma.InputJsonValue) ??
            Prisma.DbNull,
          isActive: true,
          deletedAt: null,
        },
        select: productSelect,
      });

      return presentProduct(restored);
    }

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status === 'ACTIVE'
          : true;

    try {
      const product = await this.prisma.product.create({
        data: {
          businessId,
          name,
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
          isActive,
          customAttributes:
            (customAttributes as unknown as Prisma.InputJsonValue) ??
            Prisma.DbNull,
        },
        select: productSelect,
      });

      return presentProduct(product);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }
  }

  async list(
    actor: AccessTokenPayload,
    query?: ListProductsQueryDto,
  ): Promise<PresentedProductListItem[]> {
    const businessId = await this.resolveBusinessId(actor, query?.businessId);
    const search = query?.search?.trim();

    const searchFilter = search
      ? {
          OR: [
            {
              name: { contains: search, mode: 'insensitive' as const },
            },
            {
              description: { contains: search, mode: 'insensitive' as const },
            },
            {
              variants: {
                some: {
                  deletedAt: null,
                  OR: [
                    {
                      sku: { contains: search, mode: 'insensitive' as const },
                    },
                    {
                      barcode: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
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

    const products = await this.prisma.product.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(actor.role === Role.CASHIER ? { isActive: true } : statusFilter),
        ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        ...searchFilter,
      },
      select: productListItemSelect,
      orderBy: { name: 'asc' },
    });

    return products.map((p) => presentProductListItem(p));
  }

  async getSummary(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
    requestedLocationId?: string,
  ): Promise<{
    products: number;
    units: number;
    unitsInBranch: number;
    lowStock: number;
    lowStockSkus: number;
    inventoryValue: number;
    value: number;
    currency: string;
  }> {
    const businessId = await this.resolveBusinessId(actor, requestedBusinessId);
    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : requestedLocationId?.trim() || undefined;

    const [productsCount, variants] = await Promise.all([
      this.prisma.product.count({
        where: {
          businessId,
          deletedAt: null,
          ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
        },
      }),
      this.prisma.variant.findMany({
        where: {
          businessId,
          deletedAt: null,
          product: {
            deletedAt: null,
            ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
          },
        },
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
      }),
    ]);

    let totalUnits = 0;
    let lowStockCount = 0;
    let totalInventoryValue = 0;

    const LOW_STOCK_THRESHOLD = 5;

    for (const v of variants) {
      let stock = v.stock;
      if (effectiveLocationId) {
        if (v.locationStocks && v.locationStocks.length > 0) {
          const match = v.locationStocks.find(
            (ls) => ls.locationId === effectiveLocationId,
          );
          stock = match ? match.stock : 0;
        }
      }

      totalUnits += stock;
      if (stock <= LOW_STOCK_THRESHOLD) {
        lowStockCount += 1;
      }

      const unitCost = v.costPrice != null ? v.costPrice : v.sellingPrice;
      totalInventoryValue += stock * unitCost;
    }

    return {
      products: productsCount,
      units: totalUnits,
      unitsInBranch: totalUnits,
      lowStock: lowStockCount,
      lowStockSkus: lowStockCount,
      inventoryValue: totalInventoryValue,
      value: totalInventoryValue,
      currency: 'BDT',
    };
  }

  async get(
    actor: AccessTokenPayload,
    productId: string,
    requestedBusinessId?: string,
    requestedLocationId?: string,
  ): Promise<PresentedProduct> {
    const businessId = await this.resolveBusinessId(actor, requestedBusinessId);
    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : requestedLocationId?.trim() || undefined;
    return presentProduct(
      await this.findProduct(businessId, productId),
      effectiveLocationId,
    );
  }

  async update(
    admin: AccessTokenPayload,
    productId: string,
    dto: UpdateProductDto,
    requestedBusinessId?: string,
  ): Promise<PresentedProduct> {
    const businessId = await this.resolveBusinessId(
      admin,
      requestedBusinessId || dto.businessId,
    );
    await this.findProduct(businessId, productId);
    const name = dto.name?.trim();

    if (name) {
      await this.assertNameAvailable(businessId, name, productId);
    }

    if (dto.categoryId) {
      await this.assertCategory(businessId, dto.categoryId);
    }

    const rawAttrs =
      dto.customAttributes !== undefined
        ? dto.customAttributes
        : dto.customFields !== undefined
          ? dto.customFields
          : dto.attributes !== undefined
            ? dto.attributes
            : dto.attachments;

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status === 'ACTIVE'
          : undefined;

    const data: Prisma.ProductUpdateManyMutationInput = {
      ...(name ? { name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() || null }
        : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(rawAttrs !== undefined
        ? {
            customAttributes:
              (normalizeCustomAttributes(
                rawAttrs,
              ) as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
          }
        : {}),
    };

    try {
      const updated = await this.prisma.product.updateMany({
        where: { id: productId, businessId, deletedAt: null },
        data,
      });

      if (updated.count === 0) {
        throw new NotFoundException('Product not found');
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }

    return presentProduct(await this.findProduct(businessId, productId));
  }

  async remove(
    admin: AccessTokenPayload,
    productId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // 1. Safeguard: Product CANNOT be deleted if it contains active variants
    const activeVariantsCount = this.prisma.variant?.count
      ? await this.prisma.variant.count({
          where: { productId: product.id, deletedAt: null },
        })
      : 0;

    if (activeVariantsCount > 0) {
      throw new ConflictException(
        `Cannot delete product "${product.name}" because it still contains ${activeVariantsCount} active variant(s). Please delete all variants under this product first.`,
      );
    }

    // 2. Sales history check: OrderLines containing this product or its variants
    const salesCount = this.prisma.orderLine?.count
      ? await this.prisma.orderLine.count({
          where: {
            OR: [
              { variant: { productId: product.id } },
              { productName: { equals: product.name, mode: 'insensitive' } },
            ],
          },
        })
      : 0;

    if (salesCount > 0) {
      // Soft-delete: retain historical analytics & sales records
      const timestamp = Date.now();
      const deletedAt = new Date();
      const suffixedName = `${product.name}__del_${timestamp}`;

      await this.prisma.product.update({
        where: { id: product.id },
        data: {
          name: suffixedName,
          isActive: false,
          deletedAt,
        },
      });

      return { id: productId, deletedAt };
    } else {
      // Hard-delete: clean permanent removal for products with zero sales history
      if (this.prisma.variant?.findMany) {
        const remainingVariants = await this.prisma.variant.findMany({
          where: { productId: product.id },
          select: { id: true },
        });
        for (const v of remainingVariants) {
          if (this.prisma.locationStock?.deleteMany) {
            await this.prisma.locationStock.deleteMany({
              where: { variantId: v.id },
            });
          }
          if (this.prisma.variantImage?.deleteMany) {
            await this.prisma.variantImage.deleteMany({
              where: { variantId: v.id },
            });
          }
          if (this.prisma.stockTransaction?.deleteMany) {
            await this.prisma.stockTransaction.deleteMany({
              where: { variantId: v.id },
            });
          }
        }
        if (this.prisma.variant?.deleteMany) {
          await this.prisma.variant.deleteMany({
            where: { productId: product.id },
          });
        }
      }

      await this.prisma.product.delete({
        where: { id: product.id },
      });

      return { id: productId, deletedAt: new Date() };
    }
  }

  private async findProduct(businessId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: productSelect,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async assertCategory(
    businessId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private async assertNameAvailable(
    businessId: string,
    name: string,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
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

export function presentProduct(
  product: ProductRow,
  effectiveLocationId?: string | null,
): PresentedProduct {
  const category =
    product.category && !product.category.deletedAt
      ? { id: product.category.id, name: product.category.name }
      : null;

  const variants: PresentedVariant[] = (product.variants ?? []).map((v) => {
    let stock = v.stock;
    const locationStocks: PresentedLocationStock[] = (
      (v as any).locationStocks ?? []
    ).map((ls: any) => ({
      locationId: ls.locationId,
      locationName: ls.location?.name ?? ls.locationName ?? null,
      stock: ls.stock,
      ...(ls.location
        ? { location: { id: ls.location.id, name: ls.location.name } }
        : {}),
    }));

    if (effectiveLocationId && locationStocks.length > 0) {
      const match = locationStocks.find(
        (ls) => ls.locationId === effectiveLocationId,
      );
      stock = match ? match.stock : 0;
    }

    return {
      ...v,
      stock,
      locationStocks,
    };
  });

  return {
    ...product,
    isActive: product.isActive,
    status: product.isActive === false ? 'INACTIVE' : 'ACTIVE',
    variants,
    category,
  };
}
