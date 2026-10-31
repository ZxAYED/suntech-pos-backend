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
};

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

    try {
      const product = await this.prisma.product.create({
        data: {
          businessId,
          name,
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
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
  ): Promise<PresentedProduct[]> {
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

    const products = await this.prisma.product.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(actor.role === Role.CASHIER ? { isActive: true } : {}),
        ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        ...searchFilter,
      },
      select: productSelect,
      orderBy: { name: 'asc' },
    });
    const effectiveLocationId =
      actor.role === Role.CASHIER
        ? actor.locationId
        : query?.locationId?.trim() || undefined;
    return products.map((p) => presentProduct(p, effectiveLocationId));
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

    const data: Prisma.ProductUpdateManyMutationInput = {
      ...(name ? { name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() || null }
        : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
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

    const timestamp = Date.now();
    const deletedAt = new Date();
    const suffixedName = `${product.name}__del_${timestamp}`;

    const activeVariants = this.prisma.variant?.findMany
      ? await this.prisma.variant.findMany({
          where: { productId: product.id, deletedAt: null },
          select: { id: true, sku: true, barcode: true },
        })
      : [];

    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        name: suffixedName,
        deletedAt,
      },
    });

    if (this.prisma.variant?.update) {
      for (const v of activeVariants) {
        const suffixedSku = `${v.sku}__del_${timestamp}`;
        const suffixedBarcode = v.barcode
          ? `${v.barcode}__del_${timestamp}`
          : null;
        await this.prisma.variant.update({
          where: { id: v.id },
          data: {
            sku: suffixedSku,
            barcode: suffixedBarcode,
            deletedAt,
          },
        });
      }
    }

    return { id: productId, deletedAt };
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

  return { ...product, variants, category };
}
