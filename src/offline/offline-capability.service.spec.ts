jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
import { ConfigService } from '@nestjs/config';
import { AccountStatus, Role } from '@prisma/client';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { OfflineCapabilityService } from './offline-capability.service';

const scope = { deviceId: 'till-1', businessId: 'biz-1', locationId: 'loc-1' };
const actor = {
  sub: 'cashier-1',
  role: Role.CASHIER,
  businessId: 'biz-1',
  locationId: 'loc-1',
};

function fixture(settings: Record<string, string> = {}) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const values: Record<string, string> = {
    OFFLINE_SIGNING_PRIVATE_KEY_BASE64: Buffer.from(
      pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    ).toString('base64'),
    ...settings,
  };
  const grants = new Map<string, any>();
  const enrollment = { id: 'enrollment-1', revokedAt: null as Date | null };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: actor.sub,
        businessId: 'biz-1',
        locationId: 'loc-1',
        status: AccountStatus.ACTIVE,
      }),
    },
    location: { findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }) },
    offlineDevice: { upsert: jest.fn().mockResolvedValue(enrollment) },
    offlineGrant: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        grants.set(data.id, { ...data, enrollment, revokedAt: null });
        return data;
      }),
      findUnique: jest
        .fn()
        .mockImplementation(async ({ where }) => grants.get(where.id) ?? null),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  const config = { get: (key: string) => values[key] } as ConfigService;
  const service = new OfflineCapabilityService(prisma as never, config);
  return { service, prisma, values, enrollment, grants };
}

describe('OfflineCapabilityService original-event authority', () => {
  it('issues an ES256 JWS which the browser Web Crypto API verifies, with online-only defaults', async () => {
    const { service } = fixture();
    const result = await service.provision(actor, scope);
    expect(result.claims).toMatchObject({
      userId: actor.sub,
      ...scope,
      offlineIntakeAllowed: false,
      capturedPriceAllowed: false,
    });
    expect(result.claims.exp - result.claims.iat).toBe(300);
    const [header, payload, signature] = result.grantToken.split('.');
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      result.verificationKey.jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        Buffer.from(signature, 'base64url'),
        Buffer.from(`${header}.${payload}`),
      ),
    ).toBe(true);
  });

  it('accepts a 30-day-delayed upload whose original event was inside its grant window', async () => {
    const { service } = fixture({
      OFFLINE_GRANT_TTL_SECONDS: '3600',
      OFFLINE_CAPTURED_PRICE_ENABLED: 'true',
    });
    const { grantToken, claims } = await service.provision(actor, scope);
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue((claims.exp + 30 * 86400) * 1000);
    try {
      expect(
        await service.verifyEvent(
          grantToken,
          { ...scope, userId: actor.sub },
          new Date((claims.iat + 10) * 1000),
          'CAPTURED_PRICE',
        ),
      ).toMatchObject({ jti: claims.jti });
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['userId', 'deviceId', 'businessId', 'locationId'] as const)(
    'rejects a grant replayed in another %s scope',
    async (field) => {
      const { service } = fixture();
      const { grantToken, claims } = await service.provision(actor, scope);
      await expect(
        service.verifyEvent(
          grantToken,
          { ...scope, userId: actor.sub, [field]: 'another' },
          new Date(claims.iat * 1000),
          'CURRENT_PRICE',
        ),
      ).rejects.toMatchObject({
        response: { code: 'OFFLINE_GRANT_SCOPE_MISMATCH' },
      });
    },
  );

  it('rejects signature tampering and changed claims', async () => {
    const { service } = fixture();
    const { grantToken, claims } = await service.provision(actor, scope);
    const parts = grantToken.split('.');
    parts[1] = Buffer.from(
      JSON.stringify({
        ...claims,
        exp: claims.exp + 86400,
        capturedPriceAllowed: true,
      }),
    ).toString('base64url');
    await expect(
      service.verifyEvent(
        parts.join('.'),
        { ...scope, userId: actor.sub },
        new Date(claims.iat * 1000),
        'CURRENT_PRICE',
      ),
    ).rejects.toMatchObject({ response: { code: 'OFFLINE_GRANT_INVALID' } });
  });

  it.each([-1, 300])(
    'rejects an original event %s seconds from issue outside the online grant',
    async (offset) => {
      const { service } = fixture();
      const { grantToken, claims } = await service.provision(actor, scope);
      await expect(
        service.verifyEvent(
          grantToken,
          { ...scope, userId: actor.sub },
          new Date((claims.iat + offset) * 1000),
          'CURRENT_PRICE',
        ),
      ).rejects.toMatchObject({
        response: { code: 'OFFLINE_EVENT_OUTSIDE_GRANT' },
      });
    },
  );

  it('does not turn a current-price online credential into captured-price permission', async () => {
    const { service } = fixture({ OFFLINE_CAPTURED_PRICE_ENABLED: 'true' });
    const { grantToken, claims } = await service.provision(actor, scope);
    await expect(
      service.verifyEvent(
        grantToken,
        { ...scope, userId: actor.sub },
        new Date(claims.iat * 1000),
        'CAPTURED_PRICE',
      ),
    ).rejects.toMatchObject({
      response: { code: 'CAPTURED_PRICE_NOT_ALLOWED' },
    });
  });

  it('keeps revocation separate from expiry and blocks unreviewed revoked-event posting', async () => {
    const { service, enrollment } = fixture();
    const { grantToken, claims } = await service.provision(actor, scope);
    enrollment.revokedAt = new Date();
    await expect(
      service.verifyEvent(
        grantToken,
        { ...scope, userId: actor.sub },
        new Date(claims.iat * 1000),
        'CURRENT_PRICE',
      ),
    ).rejects.toMatchObject({ response: { code: 'OFFLINE_GRANT_REVOKED' } });
    await expect(service.provision(actor, scope)).rejects.toMatchObject({
      response: { code: 'OFFLINE_DEVICE_REVOKED' },
    });
  });

  it('retains old signing-key verification for queued events after key rotation', async () => {
    const { service, values } = fixture();
    const result = await service.provision(actor, scope);
    const nextPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    values.OFFLINE_SIGNING_PRIVATE_KEY_BASE64 = Buffer.from(
      nextPair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    ).toString('base64');
    values.OFFLINE_VERIFICATION_KEYS_JSON = JSON.stringify([
      result.verificationKey,
    ]);
    expect(
      await service.verifyEvent(
        result.grantToken,
        { ...scope, userId: actor.sub },
        new Date(result.claims.iat * 1000),
        'CURRENT_PRICE',
      ),
    ).toMatchObject({ jti: result.claims.jti });
  });

  it('fails closed for missing signing keys and invalid configured lifetime', async () => {
    const { service, values } = fixture();
    values.OFFLINE_SIGNING_PRIVATE_KEY_BASE64 = '';
    await expect(service.provision(actor, scope)).rejects.toMatchObject({
      response: { code: 'OFFLINE_SIGNING_NOT_CONFIGURED' },
    });
    const invalid = fixture({ OFFLINE_GRANT_TTL_SECONDS: '-1' });
    await expect(invalid.service.provision(actor, scope)).rejects.toMatchObject(
      { response: { code: 'OFFLINE_POLICY_INVALID' } },
    );
  });

  it('checks current active account assignment before granting or uploading', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({
      id: actor.sub,
      businessId: 'biz-other',
      locationId: 'loc-other',
    });
    await expect(service.provision(actor, scope)).rejects.toMatchObject({
      response: { code: 'OFFLINE_SCOPE_REVOKED' },
    });
    expect(prisma.offlineGrant.create).not.toHaveBeenCalled();
  });

  it('allows intake to be disabled while already issued grants remain available for replay', async () => {
    const { service, values } = fixture();
    const result = await service.provision(actor, scope);
    values.OFFLINE_NEW_INTAKE_ENABLED = 'false';
    await expect(service.provision(actor, scope)).rejects.toMatchObject({
      response: { code: 'OFFLINE_INTAKE_DISABLED' },
    });
    await expect(
      service.verifyEvent(
        result.grantToken,
        { ...scope, userId: actor.sub },
        new Date(result.claims.iat * 1000),
        'CURRENT_PRICE',
      ),
    ).resolves.toMatchObject({ jti: result.claims.jti });
  });
});
