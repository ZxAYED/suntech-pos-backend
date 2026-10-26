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

export type PresentedProduct = Omit<ProductRow, 'category'> & {
  category: { id: string; name: string } | null;
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

    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        name: suffixedName,
        deletedAt,
      },
    });

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

  const variants = (product.variants ?? []).map((v) => {
    let stock = v.stock;
    if (
      effectiveLocationId &&
      (v as any).locationStocks &&
      (v as any).locationStocks.length > 0
    ) {
      const match = (v as any).locationStocks.find(
        (ls: any) => ls.locationId === effectiveLocationId,
      );
      stock = match ? match.stock : 0;
    }
    return {
      ...v,
      stock,
    };
  });

  return { ...product, variants, category };
}
