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
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const categorySelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      products: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.CategorySelect;

export type PresentedCategory = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;

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

    try {
      return await this.prisma.category.create({
        data: {
          businessId,
          name,
          description: dto.description?.trim() || null,
        },
        select: categorySelect,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(NAME_TAKEN);
      }

      throw error;
    }
  }

  list(admin: AccessTokenPayload): Promise<PresentedCategory[]> {
    return this.prisma.category.findMany({
      where: { businessId: requireBusinessId(admin), deletedAt: null },
      select: categorySelect,
      orderBy: { name: 'asc' },
    });
  }

  async get(
    admin: AccessTokenPayload,
    categoryId: string,
  ): Promise<PresentedCategory> {
    return this.findCategory(requireBusinessId(admin), categoryId);
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

    try {
      const updated = await this.prisma.category.updateMany({
        where: { id: categoryId, businessId, deletedAt: null },
        data: {
          ...(name ? { name } : {}),
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

    return this.findCategory(businessId, categoryId);
  }

  async remove(
    admin: AccessTokenPayload,
    categoryId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(admin);
    const deletedAt = new Date();
    const removed = await this.prisma.category.updateMany({
      where: { id: categoryId, businessId, deletedAt: null },
      data: { deletedAt },
    });

    if (removed.count === 0) {
      throw new NotFoundException('Category not found');
    }

    return { id: categoryId, deletedAt };
  }

  private async findCategory(businessId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, businessId, deletedAt: null },
      select: categorySelect,
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
