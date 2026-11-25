import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, Role } from '@prisma/client';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { PrismaService } from '../prisma/prisma.service';

export interface OfflineScope {
  userId: string;
  businessId: string;
  locationId: string;
  deviceId: string;
}
export interface OfflineClaims extends OfflineScope {
  version: 1;
  iss: 'suntech-pos';
  aud: 'suntech-offline';
  jti: string;
  sub: string;
  role: 'ADMIN' | 'CASHIER';
  iat: number;
  exp: number;
  permissions: Array<'CATALOG_SALE' | 'CUSTOM_SALE' | 'REFUND_PAYOUT_EVIDENCE' | 'PRODUCT_DESCRIPTION_EDIT'>;
  offlineIntakeAllowed: boolean;
  capturedPriceAllowed: boolean;
  closedShiftPolicy: 'REVIEW' | 'DETACH_WITH_WARNING';
}

const fail = (code: string, message: string) =>
  new ForbiddenException({ code, message });

/** A selling grant is not a login token. Expiry limits NEW intake, not retention or retry. */
@Injectable()
export class OfflineCapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private value(name: string): string | undefined {
    const value = this.config.get<string | number | boolean>(name);
    return value === undefined ? process.env[name] : String(value);
  }

  private signingKey() {
    const encoded = this.value('OFFLINE_SIGNING_PRIVATE_KEY_BASE64');
    if (!encoded)
      throw new ServiceUnavailableException({
        code: 'OFFLINE_SIGNING_NOT_CONFIGURED',
        message: 'Local checkout signing key has not been configured.',
      });
    try {
      const privateKey = createPrivateKey(
        Buffer.from(encoded, 'base64').toString('utf8'),
      );
      const publicKey = createPublicKey(privateKey);
      const jwk = publicKey.export({ format: 'jwk' });
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256')
        throw new Error('Expected P-256');
      const kid = createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex')
        .slice(0, 24);
      return { privateKey, publicKey, kid, jwk };
    } catch {
      throw new ServiceUnavailableException({
        code: 'OFFLINE_SIGNING_INVALID',
        message:
          'Local checkout signing key must be a valid EC P-256 private key.',
      });
    }
  }

  async assertLiveScope(
    actor: AccessTokenPayload,
    requested: { businessId?: string; locationId?: string },
  ): Promise<{ businessId: string; locationId: string }> {
    if (actor.role !== Role.ADMIN && actor.role !== Role.CASHIER)
      throw fail(
        'OFFLINE_ROLE_FORBIDDEN',
        'Only Admin and Cashier accounts can use local checkout.',
      );
    const businessId =
      actor.role === Role.CASHIER ? actor.businessId : requested.businessId;
    const locationId =
      actor.role === Role.CASHIER ? actor.locationId : requested.locationId;
    if (
      !businessId ||
      !locationId ||
      (actor.role === Role.CASHIER &&
        ((requested.businessId && requested.businessId !== businessId) ||
          (requested.locationId && requested.locationId !== locationId)))
    ) {
      throw fail(
        'OFFLINE_SCOPE_MISMATCH',
        'The current operator, business, and branch must match.',
      );
    }
    const [user, location] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          id: actor.sub,
          deletedAt: null,
          status: AccountStatus.ACTIVE,
          role: actor.role,
        },
        select: { id: true, businessId: true, locationId: true },
      }),
      this.prisma.location.findFirst({
        where: {
          id: locationId,
          businessId,
          deletedAt: null,
          business: {
            deletedAt: null,
            ...(actor.role === Role.ADMIN ? { ownerId: actor.sub } : {}),
          },
        },
        select: { id: true },
      }),
    ]);
    if (
      !user ||
      !location ||
      (actor.role === Role.CASHIER &&
        (user.businessId !== businessId || user.locationId !== locationId))
    )
      throw fail(
        'OFFLINE_SCOPE_REVOKED',
        'This operator no longer has access to this branch.',
      );
    return { businessId, locationId };
  }

  async provision(
    actor: AccessTokenPayload,
    request: { deviceId: string; businessId?: string; locationId?: string },
  ) {
    const { businessId, locationId } = await this.assertLiveScope(
      actor,
      request,
    );
    if (this.value('OFFLINE_NEW_INTAKE_ENABLED') === 'false')
      throw fail(
        'OFFLINE_INTAKE_DISABLED',
        'New local checkout is temporarily disabled. Saved sales can still be recovered.',
      );
    const key = this.signingKey();
    const rawLifetime = this.value('OFFLINE_GRANT_TTL_SECONDS');
    const lifetime =
      rawLifetime === undefined || rawLifetime === '' ? 0 : Number(rawLifetime);
    if (!Number.isSafeInteger(lifetime) || lifetime < 0)
      throw new ServiceUnavailableException({
        code: 'OFFLINE_POLICY_INVALID',
        message:
          'OFFLINE_GRANT_TTL_SECONDS must be a whole nonnegative number approved for this business.',
      });
    const offlineIntakeAllowed = lifetime > 0;
    // 300 seconds is an ONLINE preflight credential, not permission to sell disconnected.
    const now = Math.floor(Date.now() / 1000);
    const claims: OfflineClaims = {
      version: 1,
      iss: 'suntech-pos',
      aud: 'suntech-offline',
      jti: randomUUID(),
      sub: actor.sub,
      userId: actor.sub,
      deviceId: request.deviceId,
      businessId,
      locationId,
      role: actor.role as 'ADMIN' | 'CASHIER',
      iat: now,
      exp: now + (offlineIntakeAllowed ? lifetime : 300),
      permissions: ['CATALOG_SALE', 'CUSTOM_SALE'],
      offlineIntakeAllowed,
      capturedPriceAllowed:
        offlineIntakeAllowed &&
        this.value('OFFLINE_CAPTURED_PRICE_ENABLED') === 'true',
      closedShiftPolicy:
        this.value('OFFLINE_CLOSED_SHIFT_POLICY') === 'DETACH_WITH_WARNING'
          ? 'DETACH_WITH_WARNING'
          : 'REVIEW',
    };
    if (offlineIntakeAllowed && this.value('OFFLINE_REFUND_PAYOUT_EVIDENCE_ENABLED') === 'true') claims.permissions.push('REFUND_PAYOUT_EVIDENCE');
    if (offlineIntakeAllowed && actor.role === Role.ADMIN && this.value('OFFLINE_PRODUCT_DESCRIPTION_ENABLED') === 'true') claims.permissions.push('PRODUCT_DESCRIPTION_EDIT');
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: key.kid }),
    ).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const input = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(input), {
      key: key.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const grantToken = `${input}.${signature}`;
    await this.prisma.$transaction(async (tx) => {
      const device = await tx.offlineDevice.upsert({
        where: {
          deviceId_userId_businessId_locationId: {
            deviceId: request.deviceId,
            userId: actor.sub,
            businessId,
            locationId,
          },
        },
        create: {
          deviceId: request.deviceId,
          userId: actor.sub,
          businessId,
          locationId,
        },
        update: { lastSeenAt: new Date() },
      });
      if (device.revokedAt)
        throw fail(
          'OFFLINE_DEVICE_REVOKED',
          'This device enrollment was revoked.',
        );
      await tx.offlineGrant.create({
        data: {
          id: claims.jti,
          enrollmentId: device.id,
          tokenHash: createHash('sha256').update(grantToken).digest('hex'),
          claims: JSON.parse(JSON.stringify(claims)),
          issuedAt: new Date(claims.iat * 1000),
          expiresAt: new Date(claims.exp * 1000),
        },
      });
    });
    return {
      grantToken,
      claims,
      verificationKey: { kid: key.kid, jwk: key.jwk },
    };
  }

  /** Verifies original event authority, even when upload occurs AFTER grant expiry. */
  async verifyEvent(
    grantToken: string,
    scope: OfflineScope,
    occurredAt: Date,
    pricePolicy: 'CURRENT_PRICE' | 'CAPTURED_PRICE',
  ): Promise<OfflineClaims> {
    let claims: OfflineClaims;
    try {
      const parts = grantToken.split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as { alg?: string; typ?: string; kid?: string };
      if (header.alg !== 'ES256' || header.typ !== 'JWT' || !header.kid)
        throw new Error('Invalid algorithm');
      const current = this.signingKey();
      let publicKey = current.publicKey;
      if (header.kid !== current.kid) {
        const retired = JSON.parse(
          this.value('OFFLINE_VERIFICATION_KEYS_JSON') ?? '[]',
        ) as Array<{ kid: string; jwk: JsonWebKey }>;
        const match = retired.find((entry) => entry.kid === header.kid);
        if (!match || match.jwk.kty !== 'EC' || match.jwk.crv !== 'P-256')
          throw new Error('Unknown signing key');
        publicKey = createPublicKey({ key: match.jwk, format: 'jwk' });
      }
      const signature = Buffer.from(parts[2], 'base64url');
      if (
        signature.length !== 64 ||
        !verify(
          'sha256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signature,
        )
      )
        throw new Error('Invalid signature');
      claims = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as OfflineClaims;
      if (
        claims.version !== 1 ||
        claims.iss !== 'suntech-pos' ||
        claims.aud !== 'suntech-offline' ||
        claims.sub !== claims.userId ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) ||
        claims.exp <= claims.iat
      )
        throw new Error('Invalid claims');
    } catch {
      throw fail(
        'OFFLINE_GRANT_INVALID',
        'The original selling permission could not be verified. Keep the sale for review.',
      );
    }
    for (const name of [
      'userId',
      'businessId',
      'locationId',
      'deviceId',
    ] as const)
      if (claims[name] !== scope[name])
        throw fail(
          'OFFLINE_GRANT_SCOPE_MISMATCH',
          'Selling permission does not match the original operator, device, or branch.',
        );
    const eventSeconds = occurredAt.getTime() / 1000;
    if (
      !Number.isFinite(eventSeconds) ||
      eventSeconds < claims.iat ||
      eventSeconds >= claims.exp
    )
      throw fail(
        'OFFLINE_EVENT_OUTSIDE_GRANT',
        'The recorded sale time is outside its original selling permission.',
      );
    if (
      pricePolicy === 'CAPTURED_PRICE' &&
      (!claims.offlineIntakeAllowed || !claims.capturedPriceAllowed)
    )
      throw fail(
        'CAPTURED_PRICE_NOT_ALLOWED',
        'Captured historical prices have not been approved for this permission.',
      );
    const saved = await this.prisma.offlineGrant.findUnique({
      where: { id: claims.jti },
      include: { enrollment: true },
    });
    if (
      !saved ||
      saved.tokenHash !== createHash('sha256').update(grantToken).digest('hex')
    )
      throw fail(
        'OFFLINE_GRANT_UNKNOWN',
        'The original selling permission is not registered.',
      );
    if (saved.revokedAt || saved.enrollment.revokedAt)
      throw fail(
        'OFFLINE_GRANT_REVOKED',
        'This permission or device was revoked. Preserve the sale for authorized recovery.',
      );
    return claims;
  }
}
