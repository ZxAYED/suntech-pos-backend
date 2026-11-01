import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../types/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query';

@Injectable()
export class AuditReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async business(
    actor: AccessTokenPayload,
    requested?: string,
  ): Promise<string> {
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Audit logs require Admin access');
    const businessId = requested?.trim();
    if (!businessId)
      throw new BadRequestException('businessId is required for audit logs');
    const owned = await this.prisma.business.findFirst({
      where: { id: businessId, ownerId: actor.sub, deletedAt: null },
      select: { id: true },
    });
    if (!owned)
      throw new ForbiddenException('You do not have access to this business');
    return owned.id;
  }

  private async where(
    actor: AccessTokenPayload,
    query: ListAuditLogsQueryDto,
  ): Promise<Prisma.AuditLogWhereInput> {
    const businessId = await this.business(actor, query.businessId);
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException('from must be before or equal to to');
    if (query.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: query.locationId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!location)
        throw new ForbiddenException(
          'Location does not belong to the selected business',
        );
    }
    return {
      businessId,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  async list(actor: AccessTokenPayload, query: ListAuditLogsQueryDto) {
    const where = await this.where(actor, query);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const enriched = await this.enrichAuditLogs(items);
    return {
      items: enriched,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(actor: AccessTokenPayload, id: string, businessId?: string) {
    const selected = await this.business(actor, businessId);
    const item = await this.prisma.auditLog.findFirst({
      where: { id, businessId: selected },
    });
    if (!item) throw new NotFoundException('Audit log not found');
    const [enriched] = await this.enrichAuditLogs([item]);
    return enriched;
  }

  private async enrichAuditLogs(logs: Array<any>) {
    if (!logs.length) return [];

    const actorIds = new Set<string>();
    const locationIds = new Set<string>();
    const variantIds = new Set<string>();
    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    const orderIds = new Set<string>();
    const expenseIds = new Set<string>();

    for (const log of logs) {
      if (log.actorId) actorIds.add(log.actorId);
      if (log.locationId) locationIds.add(log.locationId);

      const meta = (log.metadata as Record<string, any>) || {};
      if (meta.previousLocationId) locationIds.add(meta.previousLocationId);
      if (meta.newLocationId) locationIds.add(meta.newLocationId);
      if (meta.orderId) orderIds.add(meta.orderId);

      const eType = log.entityType?.toUpperCase();
      if (eType === 'VARIANT') {
        variantIds.add(log.entityId);
      } else if (eType === 'PRODUCT') {
        productIds.add(log.entityId);
      } else if (eType === 'CATEGORY') {
        categoryIds.add(log.entityId);
      } else if (eType === 'USER') {
        actorIds.add(log.entityId);
      } else if (eType === 'ORDER') {
        orderIds.add(log.entityId);
      } else if (eType === 'EXPENSE') {
        expenseIds.add(log.entityId);
      } else if (eType === 'LOCATION') {
        locationIds.add(log.entityId);
      }
    }

    const [users, locations, variants, products, categories, orders, expenses] =
      await Promise.all([
        actorIds.size > 0
          ? this.prisma.user.findMany({
              where: { id: { in: Array.from(actorIds) } },
              select: { id: true, fullName: true, role: true },
            })
          : [],
        locationIds.size > 0
          ? this.prisma.location.findMany({
              where: { id: { in: Array.from(locationIds) } },
              select: { id: true, name: true },
            })
          : [],
        variantIds.size > 0
          ? this.prisma.variant.findMany({
              where: { id: { in: Array.from(variantIds) } },
              select: {
                id: true,
                name: true,
                sku: true,
                product: { select: { id: true, name: true } },
              },
            })
          : [],
        productIds.size > 0
          ? this.prisma.product.findMany({
              where: { id: { in: Array.from(productIds) } },
              select: { id: true, name: true },
            })
          : [],
        categoryIds.size > 0
          ? this.prisma.category.findMany({
              where: { id: { in: Array.from(categoryIds) } },
              select: { id: true, name: true },
            })
          : [],
        orderIds.size > 0
          ? this.prisma.order.findMany({
              where: { id: { in: Array.from(orderIds) } },
              select: { id: true, invoiceNumber: true },
            })
          : [],
        expenseIds.size > 0
          ? this.prisma.expense.findMany({
              where: { id: { in: Array.from(expenseIds) } },
              select: { id: true, title: true, amount: true },
            })
          : [],
      ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const locationMap = new Map(locations.map((l) => [l.id, l.name]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const productMap = new Map(products.map((p) => [p.id, p.name]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const orderMap = new Map(orders.map((o) => [o.id, o.invoiceNumber]));
    const expenseMap = new Map(expenses.map((e) => [e.id, e.title]));

    return logs.map((log) => {
      const meta = (log.metadata as Record<string, any>) || {};

      // 1. Resolve Actor
      const actorUser = userMap.get(log.actorId);
      const actorName = actorUser?.fullName || 'System User';
      const actorRole = actorUser?.role || 'SYSTEM';

      // 2. Resolve Location
      const locationName = log.locationId
        ? locationMap.get(log.locationId) || null
        : null;

      // 3. Resolve Entity & Names
      const eType = log.entityType?.toUpperCase();
      let entityName = `${log.entityType} #${log.entityId ? log.entityId.slice(0, 8) : 'Unknown'}`;
      let sku: string | null = null;
      let productName: string | null = null;
      let variantName: string | null = null;

      if (eType === 'VARIANT') {
        const variant = variantMap.get(log.entityId);
        if (variant) {
          sku = variant.sku;
          productName = variant.product?.name ?? null;
          variantName = variant.name;
          entityName =
            productName && variantName && productName !== variantName
              ? `${productName} (${variantName})`
              : variantName || productName || variant.sku;
        } else if (meta.productName || meta.variantName) {
          productName = meta.productName ?? null;
          variantName = meta.variantName ?? null;
          entityName = [productName, variantName].filter(Boolean).join(' - ');
        }
      } else if (eType === 'PRODUCT') {
        const prodName = productMap.get(log.entityId);
        if (prodName) entityName = prodName;
      } else if (eType === 'CATEGORY') {
        const catName = categoryMap.get(log.entityId);
        if (catName) entityName = catName;
      } else if (eType === 'USER') {
        const u = userMap.get(log.entityId);
        if (u) entityName = `${u.fullName} (${u.role})`;
      } else if (eType === 'ORDER') {
        const inv = orderMap.get(log.entityId) || meta.invoiceNumber;
        if (inv) entityName = `Order ${inv}`;
      } else if (eType === 'EXPENSE') {
        const title = expenseMap.get(log.entityId);
        if (title) entityName = `Expense: ${title}`;
      } else if (eType === 'LOCATION') {
        const loc = locationMap.get(log.entityId);
        if (loc) entityName = `Location: ${loc}`;
      }

      // 4. Resolve Issue & Summary
      const { issue, summary } = this.formatIssueAndSummary(
        log.action,
        eType,
        entityName,
        actorName,
        meta,
        locationMap,
      );

      // 5. Clean Metadata
      const cleanedMeta = this.cleanMetadata(log.action, meta, locationMap);

      return {
        id: log.id,
        action: log.action,
        issue,
        summary,
        actorId: log.actorId,
        actorName,
        actorRole,
        actor: {
          id: log.actorId,
          name: actorName,
          role: actorRole,
        },
        businessId: log.businessId,
        locationId: log.locationId,
        locationName,
        location: log.locationId
          ? {
              id: log.locationId,
              name: locationName || 'Unknown Location',
            }
          : null,
        entityType: log.entityType,
        entityId: log.entityId,
        entityName,
        sku,
        entity: {
          type: log.entityType,
          id: log.entityId,
          name: entityName,
          ...(sku ? { sku } : {}),
          ...(productName ? { productName } : {}),
          ...(variantName ? { variantName } : {}),
        },
        metadata: cleanedMeta,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      };
    });
  }

  private formatIssueAndSummary(
    action: string,
    entityType: string,
    entityName: string,
    actorName: string,
    meta: Record<string, any>,
    locationMap: Map<string, string>,
  ): { issue: string; summary: string } {
    switch (action) {
      case 'LOW_STOCK_AFTER_SALE': {
        const resulting =
          meta.resultingStock !== undefined ? `${meta.resultingStock}` : 'low';
        const sold =
          meta.quantitySold !== undefined
            ? ` after sale of ${meta.quantitySold}`
            : '';
        const inv = meta.invoiceNumber
          ? ` on invoice ${meta.invoiceNumber}`
          : '';
        return {
          issue: 'Low Stock Alert',
          summary: `${entityName} reached ${resulting} unit(s) remaining${sold}${inv}.`,
        };
      }
      case 'OFFLINE_PRICE_MISMATCH': {
        const charged =
          meta.chargedUnitPrice !== undefined
            ? `৳${meta.chargedUnitPrice}`
            : 'different price';
        const standard =
          meta.currentSellingPrice !== undefined
            ? `৳${meta.currentSellingPrice}`
            : 'catalog price';
        const inv = meta.invoiceNumber
          ? ` on invoice ${meta.invoiceNumber}`
          : '';
        return {
          issue: 'Offline Price Mismatch',
          summary: `${entityName} sold at ${charged} (catalog: ${standard})${inv}.`,
        };
      }
      case 'VARIANT_UNAVAILABLE': {
        const inv = meta.invoiceNumber
          ? ` on invoice ${meta.invoiceNumber}`
          : '';
        return {
          issue: 'Unavailable Variant Sold',
          summary: `${entityName} was sold while unavailable in online catalog${inv}.`,
        };
      }
      case 'BRANCH_REASSIGNMENT': {
        const prev = meta.previousLocationId
          ? locationMap.get(meta.previousLocationId) || 'Unassigned'
          : 'Unassigned';
        const next = meta.newLocationId
          ? locationMap.get(meta.newLocationId) || 'Unassigned'
          : 'Unassigned';
        return {
          issue: 'Branch Reassigned',
          summary: `${entityName} reassigned from "${prev}" to "${next}" by ${actorName}.`,
        };
      }
      case 'ADMIN_PASSWORD_RESET': {
        return {
          issue: 'Password Reset',
          summary: `Password for ${entityName} was reset by ${actorName}.`,
        };
      }
      case 'SALARY_UPDATE': {
        const prev =
          meta.previousSalary !== undefined
            ? `৳${meta.previousSalary}`
            : 'previous';
        const next =
          meta.newSalary !== undefined ? `৳${meta.newSalary}` : 'new';
        return {
          issue: 'Salary Updated',
          summary: `Monthly salary for ${entityName} updated from ${prev} to ${next} by ${actorName}.`,
        };
      }
      case 'ORDER_REFUND': {
        const inv = meta.invoiceNumber
          ? ` for invoice ${meta.invoiceNumber}`
          : '';
        return {
          issue: 'Order Refunded',
          summary: `Order ${entityName} was refunded${inv} by ${actorName}.`,
        };
      }
      default: {
        const issue = action
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        return {
          issue,
          summary: `${issue} performed on ${entityName} by ${actorName}.`,
        };
      }
    }
  }

  private cleanMetadata(
    action: string,
    meta: Record<string, any>,
    locationMap: Map<string, string>,
  ): Record<string, unknown> | null {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

    const noisyKeys = new Set([
      'orderId',
      'variantId',
      'locationId',
      'businessId',
      'actorId',
      'entityId',
      'deviceId',
    ]);

    const cleaned: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(meta)) {
      if (val === null || val === undefined) continue;
      if (noisyKeys.has(key)) continue;

      if (key === 'previousLocationId') {
        cleaned.previousLocation = locationMap.get(val) || val;
        continue;
      }
      if (key === 'newLocationId') {
        cleaned.newLocation = locationMap.get(val) || val;
        continue;
      }

      cleaned[key] = val;
    }

    return Object.keys(cleaned).length > 0 ? cleaned : null;
  }
}
