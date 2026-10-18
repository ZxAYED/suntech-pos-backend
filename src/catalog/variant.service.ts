import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants.query';
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
  createdAt: true,
  updatedAt: true,
  images: {
    select: { id: true, url: true, sortOrder: true },
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

export function presentVariant(variant: VariantRow): PresentedVariant {
  const sellingPrice = variant.sellingPrice ?? 0;
  const costPrice = variant.costPrice;
  const marginPercent =
    sellingPrice > 0 && costPrice != null
      ? Math.round(((sellingPrice - costPrice) / sellingPrice) * 100)
      : null;

  return {
    ...variant,
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

  async create(
    admin: AccessTokenPayload,
    dto: CreateVariantDto,
  ): Promise<PresentedVariant> {
    const businessId = requireBusinessId(admin);
    await this.assertProduct(businessId, dto.productId);
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

        return presentVariant(created);
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
    const businessId = requireBusinessId(actor);
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
        product: {
          businessId,
          deletedAt: null,
          ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        },
        ...(query?.productId ? { productId: query.productId } : {}),
        ...(isLowStock ? { stock: { lte: LOW_STOCK_THRESHOLD } } : {}),
        ...searchFilter,
      },
      select: variantSelect,
      orderBy: { name: 'asc' },
    });

    return variants.map(presentVariant);
  }

  async get(
    actor: AccessTokenPayload,
    variantId: string,
  ): Promise<PresentedVariant> {
    return this.findVariant(requireBusinessId(actor), variantId);
  }

  async update(
    admin: AccessTokenPayload,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<PresentedVariant> {
    const businessId = requireBusinessId(admin);
    const current = await this.findVariant(businessId, variantId);

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
        },
      });

      if (updated.count === 0) {
        throw new NotFoundException('Variant not found');
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(CODE_TAKEN);
      }

      throw error;
    }

    return this.findVariant(businessId, variantId);
  }

  async remove(
    admin: AccessTokenPayload,
    variantId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(admin);
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

  private async findVariant(businessId: string, variantId: string) {
    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, ...this.visibleWhere(businessId) },
      select: variantSelect,
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    return presentVariant(variant);
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
