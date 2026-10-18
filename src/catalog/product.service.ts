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
import { CreateProductDto } from './dto/create-product.dto';
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
} satisfies Prisma.VariantSelect;

const productSelect = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
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

  async create(
    admin: AccessTokenPayload,
    dto: CreateProductDto,
  ): Promise<PresentedProduct> {
    const businessId = requireBusinessId(admin);
    const name = dto.name.trim();
    await this.assertNameAvailable(businessId, name);

    if (dto.categoryId) {
      await this.assertCategory(businessId, dto.categoryId);
    }

    try {
      const product = await this.prisma.product.create({
        data: {
          businessId,
          name,
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
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
    const businessId = requireBusinessId(actor);
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
        ...(query?.categoryId ? { categoryId: query.categoryId } : {}),
        ...searchFilter,
      },
      select: productSelect,
      orderBy: { name: 'asc' },
    });
    return products.map(presentProduct);
  }

  async get(
    actor: AccessTokenPayload,
    productId: string,
  ): Promise<PresentedProduct> {
    return presentProduct(
      await this.findProduct(requireBusinessId(actor), productId),
    );
  }

  async update(
    admin: AccessTokenPayload,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<PresentedProduct> {
    const businessId = requireBusinessId(admin);
    await this.findProduct(businessId, productId);
    const name = dto.name?.trim();

    if (name) {
      await this.assertNameAvailable(businessId, name, productId);
    }

    if (dto.categoryId) {
      await this.assertCategory(businessId, dto.categoryId);
    }

    const data: Prisma.ProductUpdateManyMutationInput = {
      ...(name ? { name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() || null }
        : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
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
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(admin);
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

function presentProduct(product: ProductRow): PresentedProduct {
  const category =
    product.category && !product.category.deletedAt
      ? { id: product.category.id, name: product.category.name }
      : null;

  return { ...product, category };
}
