import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { getDhakaDayRange } from '../common/utils/timezone.util';
import { OfflineCapabilityService } from '../offline/offline-capability.service';
import { AdvancedAck, AdvancedCommand, parseAdvancedCommand } from '../offline/advanced/advanced-wire';
import { PrismaService } from '../prisma/prisma.service';
import { RefundService } from './refund.service';
import { deterministicStringify } from './sync-payload-hash';

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const forbidden = (code: string, message: string) => new ForbiddenException({ code, message });
function storedJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

/** A separate command protocol: never route these operations through the legacy refund or sale sync key. */
@Injectable()
export class AdvancedOfflineCommandsService {
  constructor(private readonly prisma: PrismaService, private readonly capability: OfflineCapabilityService, private readonly refunds: RefundService) {}

  async post(actor: AccessTokenPayload, raw: unknown): Promise<AdvancedAck> {
    let command: AdvancedCommand;
    try { command = parseAdvancedCommand(raw); }
    catch (cause) { throw new BadRequestException({ code: 'ADVANCED_COMMAND_INVALID', message: cause instanceof Error ? cause.message : 'Invalid command' }); }
    const scope = command.scope;
    if (scope.userId !== actor.sub) throw forbidden('ORIGINAL_ACTOR_REQUIRED', 'Sign in as the original operator to upload this command.');
    const live = await this.capability.assertLiveScope(actor, scope);
    if (live.businessId !== scope.businessId || live.locationId !== scope.locationId) throw forbidden('COMMAND_SCOPE_MISMATCH', 'The current business and branch must match the command.');
    if (command.kind === 'PRODUCT_DESCRIPTION_EDIT' && actor.role !== Role.ADMIN) throw forbidden('ADMIN_REQUIRED', 'Only an authorized store administrator can edit a product.');
    const hash = createHash('sha256').update(deterministicStringify(command)).digest('hex');
    const occurredAt = new Date(command.occurredAt);
    const replay = (row: { kind: string; payloadHash: string; userId: string; businessId: string; locationId: string; deviceId: string; postedAt: Date; result: Prisma.JsonValue }): AdvancedAck => {
      if (row.kind !== command.kind || row.payloadHash !== hash || row.userId !== scope.userId || row.businessId !== scope.businessId || row.locationId !== scope.locationId || row.deviceId !== scope.deviceId) throw conflict('COMMAND_ID_CONFLICT', 'This original command ID has different saved content. Keep it for review.');
      return { clientCommandId: command.clientCommandId, kind: command.kind, payloadHash: hash, status: 'DUPLICATE', postedAt: row.postedAt.toISOString(), result: row.result as unknown as AdvancedAck['result'] };
    };
    const already = await this.prisma.offlineCommandReceipt.findUnique({ where: { clientCommandId: command.clientCommandId } });
    if (already) return replay(already);
    const claims = await this.capability.verifyEvent(command.grantToken, scope, occurredAt, 'CURRENT_PRICE');
    if (!claims.offlineIntakeAllowed || !claims.permissions.includes(command.kind) || claims.role !== actor.role) throw forbidden('COMMAND_NOT_AUTHORIZED', 'The original signed permission does not allow this specific offline action.');
    if (occurredAt.getTime() > Date.now()) throw conflict('COMMAND_CLOCK_REVIEW', 'Original command time is in the future. Preserve it for review.');
    try {
      return await this.prisma.$transaction(async tx => {
        const existing = await tx.offlineCommandReceipt.findUnique({ where: { clientCommandId: command.clientCommandId } });
        if (existing) return replay(existing);
        // Recheck live authority and revocation within the same serializable transaction as the command.
        const user = await tx.user.findFirst({ where: { id: actor.sub, role: actor.role, status: AccountStatus.ACTIVE, deletedAt: null }, select: { businessId: true, locationId: true } });
        const location = await tx.location.findFirst({ where: { id: scope.locationId, businessId: scope.businessId, deletedAt: null, business: { deletedAt: null, ...(actor.role === Role.ADMIN ? { ownerId: actor.sub } : {}) } }, select: { id: true } });
        const grant = await tx.offlineGrant.findUnique({ where: { id: claims.jti }, include: { enrollment: true } });
        if (!user || !location || !grant || grant.revokedAt || grant.enrollment.revokedAt || grant.enrollment.userId !== scope.userId || grant.enrollment.businessId !== scope.businessId || grant.enrollment.locationId !== scope.locationId || grant.enrollment.deviceId !== scope.deviceId || (actor.role === Role.CASHIER && (user.businessId !== scope.businessId || user.locationId !== scope.locationId))) throw forbidden('COMMAND_AUTHORITY_CHANGED', 'The operator or device authority changed. Preserve original evidence.');
        let result: AdvancedAck['result'];
        if (command.kind === 'REFUND_PAYOUT_EVIDENCE') {
          // No implicit posting in a different accounting day or a newly opened shift.
          const day = getDhakaDayRange();
          if (occurredAt < day.start || occurredAt >= day.nextStart) throw conflict('HISTORICAL_REFUND_REVIEW', 'The payout happened on a different accounting day. Manager reconciliation is required; no new refund was posted.');
          const order = await tx.order.findFirst({ where: { id: command.orderId, locationId: scope.locationId, location: { businessId: scope.businessId } }, select: { id: true, status: true, paymentMethod: true, occurredAt:true, lines: { select: { id: true, unitPrice: true } } } });
          if (!order || occurredAt < order.occurredAt || !['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status) || order.paymentMethod !== command.paymentMethod || command.items.some(item => !order.lines.some(line => line.id === item.orderItemId && line.unitPrice === item.unitPrice))) throw conflict('REFUND_SOURCE_CHANGED', 'Original server order, lines, or payment method do not match. Keep the reported payout for review.');
          const refund = await this.refunds.createWithin(tx, scope.userId, scope.businessId, command.orderId, { businessId: scope.businessId, items: command.items.map(({ orderItemId, quantity }) => ({ orderItemId, quantity })), reason: command.reason, ...(command.payoutShiftId === null ? {} : { payoutShiftId: command.payoutShiftId }) }, scope.locationId, actor.role, { explicitShift: true, occurredAt });
          if (refund.totalRefund !== command.totalRefund || refund.payoutShiftId !== command.payoutShiftId) throw conflict('REFUND_EVIDENCE_MISMATCH', 'The financial result does not match the reported payout. No refund was posted.');
          result = { entityId: command.orderId, refundId: refund.id, totalRefund: refund.totalRefund };
        } else {
          // Field-level compare-and-set. No price, stock, identity or category mutation is allowed.
          const updated = await tx.product.updateMany({ where: { id: command.productId, businessId: scope.businessId, deletedAt: null, isActive: true, updatedAt: new Date(command.expectedUpdatedAt), description: command.expectedDescription }, data: { description: command.description } });
          if (updated.count !== 1) throw conflict('PRODUCT_VERSION_CONFLICT', 'The product changed since it was downloaded. Keep the edit for review instead of overwriting the server.');
          const product = await tx.product.findUniqueOrThrow({ where: { id: command.productId }, select: { updatedAt: true } });
          result = { entityId: command.productId, updatedAt: product.updatedAt.toISOString() };
        }
        // Do not store the raw capability secret in audit evidence.
        const { grantToken: _grantToken, ...evidence } = command;
        const receipt = await tx.offlineCommandReceipt.create({ data: { clientCommandId: command.clientCommandId, kind: command.kind, ...scope, payloadHash: hash, occurredAt, evidence: storedJson(evidence), result: storedJson(result) } });
        return { clientCommandId: command.clientCommandId, kind: command.kind, payloadHash: hash, status: 'ACCEPTED', postedAt: receipt.postedAt.toISOString(), result };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(cause.code)) {
        const row = await this.prisma.offlineCommandReceipt.findUnique({ where: { clientCommandId: command.clientCommandId } });
        if (row) return replay(row);
        throw conflict('COMMAND_RETRY_SAME_ID', 'Concurrent change; retry this exact command ID.');
      }
      throw cause;
    }
  }
}
