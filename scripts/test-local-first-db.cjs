/* Disposable PostgreSQL regression tests. No production DATABASE_URL is read. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, generateKeyPairSync, randomBytes } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const { firstValueFrom, from } = require('rxjs');
const bcrypt = require('bcrypt');
require('reflect-metadata');

async function main() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const testRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'suntech-offline-db-'),
  );
  const pgPort = Number(process.env.SUNTECH_TEST_PG_PORT || 55431);
  const pgPassword = randomBytes(18).toString('hex');
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(testRoot, 'database'),
    user: 'postgres',
    password: pgPassword,
    port: pgPort,
    postgresFlags: ['-c', 'unix_socket_directories=', '-h', '127.0.0.1'],
    persistent: true,
    createPostgresUser: false,
    autoRehydrateSymlinks: true,
    onLog: (message) => {
      if (/FATAL|could not|failed/i.test(String(message)))
        process.stderr.write(String(message));
    },
    onError: (message) => process.stderr.write(String(message)),
  });
  let prisma;
  let server;
  let cleanupCalled = false;
  const cleanup = async () => {
    if (cleanupCalled) return;
    cleanupCalled = true;
    if (server) server.kill('SIGTERM');
    if (prisma) await prisma.$disconnect().catch(() => {});
    await Promise.race([
      pg.stop().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await fs.rm(testRoot, { recursive: true, force: true });
  };
  process.on('SIGINT', () => cleanup().finally(() => process.exit(0)));
  process.on('SIGTERM', () => cleanup().finally(() => process.exit(0)));
  try {
    process.stdout.write('Starting disposable PostgreSQL fixture...\n');
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('suntech_local_first_test');
    const databaseUrl = `postgresql://postgres:${pgPassword}@127.0.0.1:${pgPort}/suntech_local_first_test?schema=public`;
    const migration = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      },
    );
    if (migration.status !== 0)
      throw new Error(
        `Fresh disposable migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    process.env.DATABASE_URL = databaseUrl;
    const { PrismaService } = require('../dist/prisma/prisma.service.js');
    const { OrdersService } = require('../dist/orders/order.service.js');
    const {
      LocalFirstOrdersService,
    } = require('../dist/orders/local-first-orders.service.js');
    const {
      OfflineCapabilityService,
    } = require('../dist/offline/offline-capability.service.js');
    const { OfflineService } = require('../dist/offline/offline.service.js');
    const {
      IdempotencyInterceptor,
    } = require('../dist/common/interceptors/idempotency.interceptor.js');
    prisma = new PrismaService();
    await prisma.$connect();
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const settings = {
      OFFLINE_SIGNING_PRIVATE_KEY_BASE64: Buffer.from(
        keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      ).toString('base64'),
      OFFLINE_GRANT_TTL_SECONDS: '28800',
      OFFLINE_CAPTURED_PRICE_ENABLED: 'true',
      OFFLINE_CLOSED_SHIFT_POLICY: 'REVIEW',
      OFFLINE_MAX_FUTURE_SKEW_SECONDS: '0',
    };
    const config = { get: (key) => settings[key] };
    const capabilities = new OfflineCapabilityService(prisma, config);
    const orders = new OrdersService(prisma, config);
    const local = new LocalFirstOrdersService(
      prisma,
      orders,
      capabilities,
      config,
    );
    const offline = new OfflineService(prisma, config);
    const password = `Test-${randomBytes(12).toString('hex')}`;
    const passwordHash = await bcrypt.hash(password, 4);
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@suntech.invalid`,
        fullName: 'Offline Test Admin',
        password: passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const business = await prisma.business.create({
      data: { name: 'Disposable Test Shop', ownerId: adminUser.id },
    });
    const location = await prisma.location.create({
      data: {
        name: 'Main Test Branch',
        businessId: business.id,
        address: 'Test only',
      },
    });
    const cashierUser = await prisma.user.create({
      data: {
        email: `cashier-${randomUUID()}@suntech.invalid`,
        fullName: 'Offline Test Cashier',
        publicId: 'CSH-TEST01',
        password: passwordHash,
        role: 'CASHIER',
        status: 'ACTIVE',
        businessId: business.id,
        locationId: location.id,
        isLoggedIn: true,
        sessionId: randomUUID(),
      },
    });
    const actor = {
      sub: cashierUser.id,
      role: 'CASHIER',
      businessId: business.id,
      locationId: location.id,
      sessionId: cashierUser.sessionId,
    };
    const admin = { sub: adminUser.id, role: 'ADMIN', businessId: business.id };
    const scope = {
      businessId: business.id,
      locationId: location.id,
      deviceId: `test-till-${randomUUID()}`,
    };
    const category = await prisma.category.create({
      data: { businessId: business.id, name: 'Test catalog' },
    });
    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        name: 'Test Product',
        categoryId: category.id,
      },
    });
    const uncategorized = await prisma.product.create({
      data: { businessId: business.id, name: 'No-category product' },
    });
    const variant = await prisma.variant.create({
      data: {
        businessId: business.id,
        productId: product.id,
        name: 'Real variant',
        sku: randomUUID(),
        barcode: 'TEST001',
        sellingPrice: 100,
        costPrice: 50,
        stock: 2,
      },
    });
    await prisma.locationStock.create({
      data: {
        businessId: business.id,
        locationId: location.id,
        variantId: variant.id,
        stock: 2,
      },
    });
    const shift = await prisma.shiftSession.create({
      data: {
        businessId: business.id,
        locationId: location.id,
        cashierId: cashierUser.id,
        startingAmount: 0,
      },
    });
    const permission = await capabilities.provision(actor, scope);
    const newSale = (patch = {}) => ({
      clientOrderId: randomUUID(),
      userId: actor.sub,
      orderType: 'CATALOG',
      occurredAt: new Date().toISOString(),
      shiftId: null,
      paymentMethod: 'COD',
      tenderedAmount: 100,
      pricePolicy: 'CURRENT_PRICE',
      grantToken: permission.grantToken,
      lines: [
        {
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          categoryName: category.name,
          quantity: 1,
          unitPrice: 100,
        },
      ],
      ...patch,
    });
    let checks = 0;
    const check = async (name, fn) => {
      await fn();
      checks += 1;
      process.stdout.write(`PASS ${name}\n`);
    };
    let accepted;
    let original;
    await check(
      'concurrent same identity commits one sale, one stock effect, one cash effect',
      async () => {
        original = newSale({
          tenderedAmount: 200,
          shiftId: shift.id,
          lines: [
            {
              variantId: variant.id,
              productName: product.name,
              quantity: 2,
              unitPrice: 100,
            },
          ],
        });
        const responses = await Promise.all([
          local.sync(actor, { ...scope, orders: [original] }),
          local.sync(actor, { ...scope, orders: [original] }),
        ]);
        assert.deepEqual(
          responses.map((response) => response.results[0].status).sort(),
          ['ACCEPTED', 'DUPLICATE'],
        );
        accepted = responses.find(
          (response) => response.results[0].status === 'ACCEPTED',
        ).results[0];
        assert.equal(
          await prisma.order.count({
            where: { clientOrderId: original.clientOrderId },
          }),
          1,
        );
        assert.equal(
          await prisma.stockTransaction.count({
            where: { variantId: variant.id, type: 'SALE' },
          }),
          1,
        );
        assert.equal(
          (
            await prisma.locationStock.findUnique({
              where: {
                locationId_variantId: {
                  locationId: location.id,
                  variantId: variant.id,
                },
              },
            })
          ).stock,
          0,
        );
        assert.equal(
          (await prisma.shiftSession.findUnique({ where: { id: shift.id } }))
            .cashCollected,
          200,
        );
      },
    );
    await check(
      'lost acknowledgment replays the identical official receipt and warning',
      async () => {
        const replay = (
          await local.sync(actor, { ...scope, orders: [original] })
        ).results[0];
        assert.equal(replay.status, 'DUPLICATE');
        assert.deepEqual(
          replay.order,
          JSON.parse(JSON.stringify(accepted.order)),
        );
        assert.deepEqual(replay.warnings, accepted.warnings);
        assert.ok(replay.warnings.includes('LOW_STOCK_AFTER_SALE'));
      },
    );
    await check(
      'a changed payload under the same ID is retained for review without another effect',
      async () => {
        const replay = (
          await local.sync(actor, {
            ...scope,
            orders: [{ ...original, notes: 'changed' }],
          })
        ).results[0];
        assert.equal(replay.code, 'SYNC_PAYLOAD_MISMATCH');
        assert.equal(
          await prisma.order.count({
            where: { clientOrderId: original.clientOrderId },
          }),
          1,
        );
      },
    );
    await check(
      'online preflight is read-only and late CURRENT_PRICE rejection rolls back identity',
      async () => {
        const item = newSale();
        await local.validateCurrent(actor, {
          ...scope,
          userId: actor.sub,
          orderType: item.orderType,
          paymentMethod: item.paymentMethod,
          tenderedAmount: item.tenderedAmount,
          shiftId: null,
          lines: item.lines,
        });
        assert.equal(
          await prisma.financialSaleIdentity.count({
            where: { id: item.clientOrderId },
          }),
          0,
        );
        await prisma.variant.update({
          where: { id: variant.id },
          data: { sellingPrice: 120 },
        });
        const result = (await local.sync(actor, { ...scope, orders: [item] }))
          .results[0];
        assert.equal(result.code, 'PRICE_CHANGED');
        assert.equal(
          await prisma.order.count({
            where: { clientOrderId: item.clientOrderId },
          }),
          0,
        );
        assert.equal(
          await prisma.financialSaleIdentity.count({
            where: { id: item.clientOrderId },
          }),
          0,
        );
      },
    );
    await check(
      'approved captured price preserves paid amount, permits negative stock, and null shift stays null',
      async () => {
        const result = (
          await local.sync(actor, {
            ...scope,
            orders: [newSale({ pricePolicy: 'CAPTURED_PRICE' })],
          })
        ).results[0];
        assert.equal(result.status, 'ACCEPTED');
        assert.equal(result.order.totalAmount, 100);
        assert.equal(result.order.lines[0].unitPrice, 100);
        assert.equal(result.order.shiftId, null);
        assert.ok(result.warnings.includes('OFFLINE_PRICE_MISMATCH'));
        assert.equal(
          (
            await prisma.locationStock.findUnique({
              where: {
                locationId_variantId: {
                  locationId: location.id,
                  variantId: variant.id,
                },
              },
            })
          ).stock,
          -1,
        );
        assert.equal(
          (await prisma.shiftSession.findUnique({ where: { id: shift.id } }))
            .cashCollected,
          200,
        );
      },
    );
    await check(
      'receipt-write fault rolls back order, stock, drawer cash, audit and identity together',
      async () => {
        await prisma.variant.update({
          where: { id: variant.id },
          data: { sellingPrice: 100 },
        });
        const item = newSale({ shiftId: shift.id });
        const stockBefore = await prisma.locationStock.findUnique({
          where: {
            locationId_variantId: {
              locationId: location.id,
              variantId: variant.id,
            },
          },
        });
        const cashBefore = (
          await prisma.shiftSession.findUnique({ where: { id: shift.id } })
        ).cashCollected;
        const effectsBefore = await prisma.stockTransaction.count({
          where: { variantId: variant.id },
        });
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."clientOrderId" = '${item.clientOrderId}' AND NEW."syncReceipt" IS NOT NULL THEN RAISE EXCEPTION 'test receipt failure'; END IF; RETURN NEW; END; $$`,
        );
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER test_receipt_failure_trigger BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION test_receipt_failure()',
        );
        try {
          const result = (await local.sync(actor, { ...scope, orders: [item] }))
            .results[0];
          assert.equal(result.status, 'REJECTED');
          assert.equal(result.retryable, true);
          assert.equal(
            await prisma.order.count({
              where: { clientOrderId: item.clientOrderId },
            }),
            0,
          );
          assert.equal(
            await prisma.financialSaleIdentity.count({
              where: { id: item.clientOrderId },
            }),
            0,
          );
          assert.equal(
            (
              await prisma.locationStock.findUnique({
                where: {
                  locationId_variantId: {
                    locationId: location.id,
                    variantId: variant.id,
                  },
                },
              })
            ).stock,
            stockBefore.stock,
          );
          assert.equal(
            (await prisma.shiftSession.findUnique({ where: { id: shift.id } }))
              .cashCollected,
            cashBefore,
          );
          assert.equal(
            await prisma.stockTransaction.count({
              where: { variantId: variant.id },
            }),
            effectsBefore,
          );
          assert.equal(
            await prisma.auditLog.count({
              where: {
                action: 'OFFLINE_ORDER_ACCEPTED',
                metadata: {
                  path: ['clientOrderId'],
                  equals: item.clientOrderId,
                },
              },
            }),
            0,
          );
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER test_receipt_failure_trigger ON "Order"',
          );
          await prisma.$executeRawUnsafe(
            'DROP FUNCTION test_receipt_failure()',
          );
        }
        assert.equal(
          (await local.sync(actor, { ...scope, orders: [item] })).results[0]
            .status,
          'ACCEPTED',
        );
      },
    );
    await check('a missing real variant goes to review before any financial effect', async () => {
      const item = newSale({ pricePolicy: 'CAPTURED_PRICE' });
      const stockBefore = await prisma.stockTransaction.count({ where: { variantId: variant.id } });
      await prisma.variant.update({ where: { id: variant.id }, data: { deletedAt: new Date() } });
      try {
        const result = (await local.sync(actor, { ...scope, orders: [item] })).results[0];
        assert.equal(result.status, 'REJECTED');
        assert.equal(result.code, 'ITEM_UNAVAILABLE_REVIEW_REQUIRED');
        assert.equal(result.retryable, false);
        assert.equal(await prisma.order.count({ where: { clientOrderId: item.clientOrderId } }), 0);
        assert.equal(await prisma.financialSaleIdentity.count({ where: { id: item.clientOrderId } }), 0);
        assert.equal(await prisma.stockTransaction.count({ where: { variantId: variant.id } }), stockBefore);
      } finally {
        await prisma.variant.update({ where: { id: variant.id }, data: { deletedAt: null } });
      }
    });
    await check(
      'partial batch preserves rejection and posts a valid manual BANK custom sale without stock/cash effect',
      async () => {
        const cashBefore = (
          await prisma.shiftSession.findUnique({ where: { id: shift.id } })
        ).cashCollected;
        const stockBefore = await prisma.stockTransaction.count();
        const result = await local.sync(actor, {
          ...scope,
          orders: [
            newSale({ tenderedAmount: 2147483648 }),
            newSale({
              orderType: 'CUSTOM',
              paymentMethod: 'BANK',
              shiftId: shift.id,
              lines: [
                { productName: 'Repair service', quantity: 1, unitPrice: 100 },
              ],
            }),
          ],
        });
        assert.equal(result.results[0].status, 'REJECTED');
        assert.equal(result.results[1].status, 'ACCEPTED');
        assert.equal(
          (await prisma.shiftSession.findUnique({ where: { id: shift.id } }))
            .cashCollected,
          cashBefore,
        );
        assert.equal(await prisma.stockTransaction.count(), stockBefore);
      },
    );
    await check(
      '101 queued sales drain across requests, and complete snapshot contains all original-device acknowledgments',
      async () => {
        const items = Array.from({ length: 101 }, () =>
          newSale({
            orderType: 'CUSTOM',
            paymentMethod: 'BANK',
            lines: [{ productName: 'Batch item', quantity: 1, unitPrice: 100 }],
          }),
        );
        for (const batch of [items.slice(0, 100), items.slice(100)]) {
          const response = await local.sync(actor, { ...scope, orders: batch });
          assert.ok(
            response.results.every((result) => result.status === 'ACCEPTED'),
          );
        }
        const snapshot = await offline.bootstrapV2(actor, scope);
        assert.equal(snapshot.acceptedIdsComplete, true);
        assert.ok(snapshot.acceptedClientOrderIds.length > 100);
        assert.ok(
          items.every((item) =>
            snapshot.acceptedClientOrderIds.includes(item.clientOrderId),
          ),
        );
        assert.ok(
          snapshot.products.some((item) => item.id === uncategorized.id),
        );
        assert.equal(snapshot.manifest.counts.products, 2);
        assert.equal(snapshot.manifest.history.complete, false);
        assert.ok(snapshot.history.every((order) => order.clientOrderId));
      },
    );
    await check(
      'Admin local-first and legacy v1 sync use the explicitly selected owned business/branch',
      async () => {
        const anotherBusiness = await prisma.business.create({
          data: { name: 'Other owned business', ownerId: admin.sub },
        });
        const anotherLocation = await prisma.location.create({
          data: { name: 'Selected branch', businessId: anotherBusiness.id },
        });
        const selected = {
          deviceId: scope.deviceId,
          businessId: anotherBusiness.id,
          locationId: anotherLocation.id,
        };
        const grant = await capabilities.provision(admin, selected);
        const item = newSale({
          userId: admin.sub,
          orderType: 'CUSTOM',
          grantToken: grant.grantToken,
          lines: [{ productName: 'Admin item', quantity: 1, unitPrice: 100 }],
        });
        const response = (
          await local.sync(admin, { ...selected, orders: [item] })
        ).results[0];
        assert.equal(response.status, 'ACCEPTED');
        assert.equal(response.order.cashierId, admin.sub);
        assert.equal(response.order.businessId, anotherBusiness.id);
        const { userId, grantToken, pricePolicy, ...legacyItem } = {
          ...item,
          clientOrderId: randomUUID(),
        };
        const legacy = (
          await orders.syncOrders(admin, { ...selected, orders: [legacyItem] })
        ).results[0];
        assert.equal(legacy.status, 'ACCEPTED');
      },
    );
    await check(
      'a concurrent legacy HTTP request and v2 request cannot both own the same purchase',
      async () => {
        const item = newSale({
          orderType: 'CUSTOM',
          paymentMethod: 'BANK',
          notes: `Mixed-protocol test ${randomUUID()}`,
          lines: [
            { productName: 'Mixed-protocol item', quantity: 1, unitPrice: 100 },
          ],
        });
        const legacyBody = {
          shiftId: null,
          paymentMethod: item.paymentMethod,
          tenderedAmount: 100,
          notes: item.notes,
          lines: item.lines,
        };
        const request = {
          method: 'POST',
          path: '/api/v1/orders/custom',
          body: legacyBody,
          query: {},
          user: actor,
          header: (name) =>
            name === 'idempotency-key' ? item.clientOrderId : undefined,
        };
        const context = {
          getHandler: () => function handler() {},
          getClass: () => class Controller {},
          switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => ({ status() {} }),
          }),
        };
        const interceptor = new IdempotencyInterceptor(
          { getAllAndOverride: () => true, get: () => 201 },
          prisma,
        );
        await Promise.allSettled([
          (async () =>
            firstValueFrom(
              await interceptor.intercept(context, {
                handle: () => from(orders.createCustomOrder(actor, legacyBody)),
              }),
            ))(),
          local.sync(actor, { ...scope, orders: [item] }),
        ]);
        assert.equal(
          await prisma.order.count({ where: { notes: item.notes } }),
          1,
        );
        assert.equal(
          await prisma.financialSaleIdentity.count({
            where: { id: item.clientOrderId },
          }),
          1,
        );
      },
    );
    await check(
      '30-day-old original event posts on its original date and expiry does not erase retry authority',
      async () => {
        const actualNow = Date.now;
        const oldInstant = actualNow() - 30 * 86400 * 1000;
        let oldGrant;
        Date.now = () => oldInstant;
        try {
          oldGrant = await capabilities.provision(actor, scope);
        } finally {
          Date.now = actualNow;
        }
        const occurredAt = new Date(
          (oldGrant.claims.iat + 1) * 1000,
        ).toISOString();
        const item = newSale({
          occurredAt,
          grantToken: oldGrant.grantToken,
          pricePolicy: 'CAPTURED_PRICE',
          orderType: 'CUSTOM',
          paymentMethod: 'BANK',
          lines: [
            { productName: 'Restored old event', quantity: 1, unitPrice: 100 },
          ],
        });
        const result = (await local.sync(actor, { ...scope, orders: [item] }))
          .results[0];
        assert.equal(result.status, 'ACCEPTED');
        assert.equal(
          new Date(result.order.occurredAt).toISOString(),
          occurredAt,
        );
        assert.ok(
          new Date(result.order.createdAt).getTime() >
            new Date(occurredAt).getTime() + 29 * 86400 * 1000,
        );
        const replay = (await local.sync(actor, { ...scope, orders: [item] }))
          .results[0];
        assert.equal(replay.status, 'DUPLICATE');
      },
    );
    await check(
      'database restart retains original identities, stable receipts, and replay protection',
      async () => {
        await prisma.$disconnect();
        await pg.stop();
        await pg.start();
        await prisma.$connect();
        const replay = (
          await local.sync(actor, { ...scope, orders: [original] })
        ).results[0];
        assert.equal(replay.status, 'DUPLICATE');
        assert.deepEqual(
          replay.order,
          JSON.parse(JSON.stringify(accepted.order)),
        );
      },
    );
    const version = await prisma.$queryRawUnsafe('SELECT version()');
    const report = {
      passed: checks,
      failed: 0,
      postgres: version[0].version,
      tests:
        'Actual PostgreSQL transactions; Node calls production service classes; temporary database only.',
    };
    await fs.mkdir(path.resolve(__dirname, '../test-results'), {
      recursive: true,
    });
    await fs.writeFile(
      path.resolve(__dirname, '../test-results/local-first-db.json'),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(`DATABASE REGRESSIONS: ${checks} passed\n`);
    if (process.argv.includes('--serve')) {
      await prisma.user.update({
        where: { id: cashierUser.id },
        data: { isLoggedIn: false, sessionId: null },
      });
      const serverEnv = {
        ...process.env,
        ...settings,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        PORT: '4000',
        FRONTEND_URL: 'http://localhost:3000',
        JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
        JWT_RESET_SECRET: randomBytes(48).toString('hex'),
        JWT_ACCESS_TTL: '7d',
        JWT_REFRESH_TTL: '30d',
        CLOUDINARY_CLOUD_NAME: 'test',
        CLOUDINARY_API_KEY: 'test',
        CLOUDINARY_API_SECRET: 'test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '2525',
        SMTP_USER: 'test',
        SMTP_PASS: 'test',
        MAIL_FROM: 'test@suntech.invalid',
        RUN_BOOTSTRAP_SEED: 'false',
      };
      server = spawn(process.execPath, ['dist/main.js'], {
        cwd: path.resolve(__dirname, '..'),
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      server.stdout.on('data', (chunk) => process.stdout.write(chunk));
      server.stderr.on('data', (chunk) => process.stderr.write(chunk));
      const fixturePath = path.resolve(
        __dirname,
        '../../test-runtime/backend-fixture.json',
      );
      await fs.mkdir(path.dirname(fixturePath), { recursive: true });
      await fs.writeFile(
        fixturePath,
        JSON.stringify(
          {
            apiUrl: 'http://localhost:4000/api/v1',
            admin: { email: adminUser.email, password, userId: adminUser.id },
            cashier: {
              email: cashierUser.email,
              publicId: cashierUser.publicId,
              password,
              userId: cashierUser.id,
            },
            businessId: business.id,
            locationId: location.id,
            variantId: variant.id,
            sku: variant.sku,
            barcode: variant.barcode,
            shiftId: shift.id,
            fixtureDeviceId: scope.deviceId,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      process.stdout.write(
        `TEST SERVER STARTING; fixture file: ${fixturePath}\n`,
      );
      await new Promise((resolve, reject) => {
        server.once('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Test backend exited with ${code}`)),
        );
      });
    }
  } finally {
    await cleanup();
  }
}
main().catch((error) => {
  process.stderr.write(
    `${error?.stack || error || 'PostgreSQL fixture stopped unexpectedly'}\n`,
  );
  process.exitCode = 1;
});
