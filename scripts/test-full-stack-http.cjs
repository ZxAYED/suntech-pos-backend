/* Runs real Nest + PostgreSQL + production Next BFF in ONE local process namespace.
 * This is HTTP integration coverage. It is not a browser/PWA/printing test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(headers) {
    for (const entry of headers.getSetCookie()) {
      const [pair, ...attributes] = entry
        .split(';')
        .map((value) => value.trim());
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      const scope =
        attributes.find((attribute) => /^path=/i.test(attribute))?.slice(5) ||
        '/';
      const key = `${name}:${scope}`;
      if (
        !value ||
        attributes.some((attribute) => /^max-age=0$/i.test(attribute))
      )
        this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path: scope, attributes });
    }
  }
  header(requestPath) {
    return [...this.cookies.values()]
      .filter(
        (cookie) =>
          requestPath === cookie.path ||
          requestPath.startsWith(
            cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`,
          ),
      )
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
  has(name) {
    return [...this.cookies.values()].some((cookie) => cookie.name === name);
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const backendRoot = path.resolve(__dirname, '..');
  const frontendRoot = process.env.SUNTECH_FRONTEND_DIR
    ? path.resolve(process.env.SUNTECH_FRONTEND_DIR)
    : path.resolve(backendRoot, '../frontend');
  const fixturePath = path.resolve(
    backendRoot,
    '../test-runtime/backend-fixture.json',
  );
  const reportDirectory = path.resolve(backendRoot, 'test-results');
  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.rm(fixturePath, { force: true });
  const processes = [];
  const logs = { backend: '', frontend: '' };
  const children = (name, arguments_, cwd, env) => {
    const child = spawn(process.execPath, arguments_, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        logs[name] = (logs[name] + chunk).slice(-100000);
      });
    processes.push(child);
    return child;
  };
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGINT');
    for (
      let attempt = 0;
      attempt < 40 && child.exitCode === null && child.signalCode === null;
      attempt++
    )
      await pause(100);
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  }
  async function waitHttp(url, child, acceptable) {
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Child server exited before ${url} became ready`);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000),
          redirect: 'manual',
        });
        if (acceptable(response.status)) return;
      } catch {
        /* Startup may still be applying migrations. */
      }
      await pause(150);
    }
    throw new Error(`Server readiness timed out: ${url}`);
  }
  const cases = [];
  const facts = {
    browserQualified: false,
    coverage:
      'Real HTTP through production Next BFF, live Nest controllers/guards, and disposable PostgreSQL; no browser automation.',
  };
  async function check(name, execute) {
    await execute();
    cases.push(name);
    process.stdout.write(`PASS ${name}\n`);
  }
  let backend;
  let frontend;
  try {
    process.stdout.write(
      'Starting one disposable database/backend/frontend test environment...\n',
    );
    backend = children(
      'backend',
      ['scripts/test-local-first-db.cjs', '--serve'],
      backendRoot,
      { SUNTECH_TEST_PG_PORT: '55431' },
    );
    await waitHttp(
      'http://127.0.0.1:4000/',
      backend,
      (status) => status === 200,
    );
    const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    const frontendSecret = randomBytes(48).toString('hex');
    frontend = children(
      'frontend',
      [
        'node_modules/next/dist/bin/next',
        'start',
        '-H',
        '127.0.0.1',
        '-p',
        '4001',
      ],
      frontendRoot,
      {
        NODE_ENV: 'production',
        BACKEND_API_URL: 'http://127.0.0.1:4000',
        SUNTECH_SESSION_SECRET: frontendSecret,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    );
    const origin = 'http://localhost:4001';
    await waitHttp(
      `${origin}/api/session`,
      frontend,
      (status) => status === 401,
    );
    const jar = new CookieJar();
    async function request(
      endpoint,
      { method = 'GET', body, cookieJar = jar, headers = {} } = {},
    ) {
      const outgoing = { accept: 'application/json', ...headers };
      const cookie = cookieJar?.header(endpoint);
      if (cookie) outgoing.cookie = cookie;
      if (body !== undefined) outgoing['content-type'] = 'application/json';
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        outgoing.origin === undefined
      )
        outgoing.origin = origin;
      const response = await fetch(`${origin}${endpoint}`, {
        method,
        headers: outgoing,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      cookieJar?.absorb(response.headers);
      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* Static HTML/worker. */
      }
      return { status: response.status, headers: response.headers, json, text };
    }
    const loginBody = {
      loginType: 'BUSINESS_USER',
      publicId: fixture.cashier.publicId,
      password: fixture.cashier.password,
    };
    await check(
      'anonymous protected API remains unauthorized and cross-origin mutations remain blocked',
      async () => {
        const unauthorized = await request('/api/v1/orders', {
          cookieJar: null,
        });
        assert.equal(unauthorized.status, 401);
        const crossSite = await request('/api/v1/offline/provision', {
          method: 'POST',
          body: { deviceId: 'untrusted' },
          cookieJar: null,
          headers: {
            origin: 'https://untrusted.invalid',
            'sec-fetch-site': 'cross-site',
          },
        });
        assert.equal(crossSite.status, 403);
      },
    );
    await check(
      'cashier login through BFF keeps all HttpOnly cookies and hides the access token from JavaScript',
      async () => {
        const login = await request('/api/v1/auth/login', {
          method: 'POST',
          body: loginBody,
        });
        if (login.status !== 200) throw new Error(`BFF login failed ${login.status}: ${login.json?.message || 'no public error message'}`);
        assert.equal(login.json.data.user.id, fixture.cashier.userId);
        assert.equal(login.json.data.accessToken, undefined);
        for (const name of ['accessToken', 'suntech_session', 'refreshToken']) {
          assert.ok(jar.has(name), `${name} cookie missing`);
          assert.ok(
            login.headers
              .getSetCookie()
              .some(
                (cookie) =>
                  cookie.startsWith(`${name}=`) && /httponly/i.test(cookie),
              ),
            `${name} must be HttpOnly`,
          );
        }
        const session = await request('/api/session');
        assert.equal(session.status, 200);
        assert.equal(session.json.user.id, fixture.cashier.userId);
        assert.match(session.headers.get('cache-control'), /no-store/i);
      },
    );
    const scope = {
      deviceId: `http-test-${randomUUID()}`,
      businessId: fixture.businessId,
      locationId: fixture.locationId,
    };
    let permission;
    await check(
      'provision returns signed operator/device/branch permission and a complete private snapshot',
      async () => {
        const result = await request('/api/v1/offline/provision', {
          method: 'POST',
          body: scope,
        });
        assert.equal(result.status, 200);
        permission = result.json.data;
        assert.equal(permission.claims.userId, fixture.cashier.userId);
        assert.equal(permission.claims.deviceId, scope.deviceId);
        assert.equal(permission.bootstrap.manifest.complete, true);
        assert.equal(permission.bootstrap.acceptedIdsComplete, true);
        assert.equal(permission.bootstrap.user.status, 'ACTIVE');
        assert.equal(permission.verificationKey.jwk.kty, 'EC');
        assert.equal(permission.verificationKey.jwk.d, undefined);
        assert.match(result.headers.get('cache-control'), /no-store/i);
      },
    );
    const line = {
      variantId: fixture.variantId,
      productName: 'Test Product',
      quantity: 1,
      unitPrice: 100,
    };
    const preflight = {
      ...scope,
      userId: fixture.cashier.userId,
      orderType: 'CATALOG',
      paymentMethod: 'COD',
      tenderedAmount: 100,
      shiftId: null,
      lines: [line],
    };
    await check(
      'live PRICE_CHANGED fields survive Nest exception handling and the Next proxy',
      async () => {
        const result = await request('/api/v1/orders/sync-v2/validate', {
          method: 'POST',
          body: { ...preflight, lines: [{ ...line, unitPrice: 99 }] },
        });
        assert.equal(result.status, 409);
        assert.equal(result.json.code, 'PRICE_CHANGED');
        assert.equal(result.json.variantId, fixture.variantId);
        assert.equal(result.json.submittedPrice, 99);
        assert.equal(result.json.currentPrice, 100);
      },
    );
    await check(
      'valid online preflight succeeds without posting a sale',
      async () => {
        const result = await request('/api/v1/orders/sync-v2/validate', {
          method: 'POST',
          body: preflight,
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.data.valid, true);
      },
    );
    const newSale = (patch = {}) => ({
      clientOrderId: randomUUID(),
      userId: fixture.cashier.userId,
      orderType: 'CATALOG',
      occurredAt: new Date().toISOString(),
      shiftId: null,
      paymentMethod: 'COD',
      tenderedAmount: 100,
      pricePolicy: 'CURRENT_PRICE',
      grantToken: permission.grantToken,
      lines: [line],
      ...patch,
    });
    const original = newSale();
    let accepted;
    await check(
      'v2 sync and exact retry return one official receipt with real order-line identities',
      async () => {
        const first = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: { ...scope, orders: [original] },
        });
        assert.equal(first.status, 200);
        accepted = first.json.data.results[0];
        if (accepted.status !== 'ACCEPTED') throw new Error(`Initial v2 HTTP sale: ${accepted.code}: ${accepted.error}`);
        assert.equal(accepted.order.cashierId, fixture.cashier.userId);
        assert.equal(accepted.order.businessId, fixture.businessId);
        assert.equal(accepted.order.locationId, fixture.locationId);
        assert.equal(accepted.order.totalAmount, 100);
        assert.ok(accepted.order.lines[0].id);
        const repeated = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: { ...scope, orders: [original] },
        });
        assert.equal(repeated.status, 200);
        assert.equal(repeated.json.data.results[0].status, 'DUPLICATE');
        assert.deepEqual(repeated.json.data.results[0].order, accepted.order);
      },
    );
    await check(
      'changed content under an accepted UUID returns review without repricing or replacing the order',
      async () => {
        const result = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: { ...scope, orders: [{ ...original, notes: 'changed' }] },
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.data.results[0].code, 'SYNC_PAYLOAD_MISMATCH');
        assert.equal(result.json.data.results[0].retryable, false);
      },
    );
    await check(
      'HTTP 200 partial batches retain invalid sales while acknowledging valid ones individually',
      async () => {
        const valid = newSale({
          orderType: 'CUSTOM',
          paymentMethod: 'BANK',
          lines: [
            { productName: 'HTTP service item', quantity: 1, unitPrice: 100 },
          ],
        });
        const result = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: { ...scope, orders: [newSale({ tenderedAmount: 1 }), valid] },
        });
        assert.equal(result.status, 200);
        assert.deepEqual(
          result.json.data.results.map((item) => item.status),
          ['REJECTED', 'ACCEPTED'],
        );
      },
    );
    await check(
      'a normal 100-event signed batch larger than 100 KB passes the scoped JSON parser',
      async () => {
        const items = Array.from({ length: 100 }, () =>
          newSale({
            orderType: 'CUSTOM',
            paymentMethod: 'BANK',
            lines: [
              { productName: 'HTTP backlog', quantity: 1, unitPrice: 100 },
            ],
          }),
        );
        const body = { ...scope, orders: items };
        facts.batchBytes = Buffer.byteLength(JSON.stringify(body));
        assert.ok(
          facts.batchBytes > 100 * 1024,
          'Fixture must exceed the old default parser limit',
        );
        const result = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body,
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.data.results.length, 100);
        assert.ok(
          result.json.data.results.every((item) => item.status === 'ACCEPTED'),
        );
      },
    );
    await check(
      'an oversized v2 request returns structured 413 and legacy routes retain their original 100 KB bound',
      async () => {
        const huge = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: { padding: 'x'.repeat(4 * 1024 * 1024 + 1000) },
        });
        assert.equal(huge.status, 413);
        assert.equal(huge.json.code, 'REQUEST_TOO_LARGE');
        const legacy = await request('/api/v1/orders/custom', {
          method: 'POST',
          body: { notes: 'x'.repeat(110 * 1024) },
          headers: { 'idempotency-key': randomUUID() },
        });
        assert.equal(legacy.status, 413);
      },
    );
    await check(
      'authoritative status lookup and HEAD keep their original HTTP semantics',
      async () => {
        const result = await request('/api/v1/orders/sync-v2/status', {
          method: 'POST',
          body: {
            ...scope,
            clientOrderIds: [original.clientOrderId, randomUUID()],
          },
        });
        assert.equal(result.status, 200);
        assert.deepEqual(
          result.json.data.results.map((item) => item.status),
          ['ACCEPTED', 'NOT_FOUND'],
        );
        const head = await request('/api/v1/orders', { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(head.text, '');
      },
    );
    let legacyKey, legacyOrder;
    await check(
      'legacy custom checkout still creates and replays its existing 201 response',
      async () => {
        legacyKey = randomUUID();
        const body = {
          tenderedAmount: 100,
          paymentMethod: 'BKASH',
          shiftId: null,
          lines: [
            { productName: 'Legacy HTTP item', quantity: 1, unitPrice: 100 },
          ],
        };
        const first = await request('/api/v1/orders/custom', {
          method: 'POST',
          body,
          headers: { 'idempotency-key': legacyKey },
        });
        const repeated = await request('/api/v1/orders/custom', {
          method: 'POST',
          body,
          headers: { 'idempotency-key': legacyKey },
        });
        assert.equal(first.status, 201);
        assert.equal(repeated.status, 201);
        assert.equal(first.json.data.id, repeated.json.data.id);
        legacyOrder = first.json.data;
        const status = await request(
          `/api/v1/orders/legacy-status/${legacyKey}`,
        );
        assert.equal(status.status, 200);
        assert.equal(status.json.data.status, 'CONFIRMED');
        assert.equal(status.json.data.canCreateReplacement, false);
      },
    );
    await check(
      'old HTTP purchase identity cannot be posted through v2 as a second sale',
      async () => {
        const result = await request('/api/v1/orders/sync-v2', {
          method: 'POST',
          body: {
            ...scope,
            orders: [
              newSale({
                clientOrderId: legacyKey,
                orderType: 'CUSTOM',
                lines: [
                  {
                    productName: 'Legacy HTTP item',
                    quantity: 1,
                    unitPrice: 100,
                  },
                ],
              }),
            ],
          },
        });
        assert.equal(result.status, 200);
        assert.equal(
          result.json.data.results[0].code,
          'LEGACY_OPERATION_REVIEW_REQUIRED',
        );
      },
    );
    await check(
      'existing refund endpoint atomically stores its original 201 envelope and safely replays a concurrent retry',
      async () => {
        const key = randomUUID();
        const route = `/api/v1/orders/${legacyOrder.id}/refunds`;
        const body = { items: [{ orderItemId: legacyOrder.lines[0].id, quantity: 1 }], reason: 'HTTP recovery test' };
        const options = { method: 'POST', body, headers: { 'idempotency-key': key } };
        const attempts = await Promise.all([request(route, options), request(route, options)]);
        const accepted = attempts.find(response => response.status === 201);
        assert.ok(accepted, JSON.stringify(attempts.map(response => response.json)));
        assert.ok(attempts.every(response => response.status === 201 || response.status === 409));
        assert.equal(accepted.json.success, true);
        assert.equal(accepted.json.message, 'Refund completed');
        assert.equal(accepted.json.data.totalRefund, 100);
        assert.equal(accepted.json.data.orderId, legacyOrder.id);
        assert.equal(accepted.json.data.refundStatus, 'REFUNDED');
        const replay = await request(route, options);
        assert.equal(replay.status, 201);
        assert.deepEqual(replay.json, accepted.json);
        const changed = await request(route, { ...options, body: { ...body, reason: 'Different request' } });
        assert.equal(changed.status, 409);
        const over = await request(route, { ...options, headers: { 'idempotency-key': randomUUID() } });
        assert.equal(over.status, 409);
      },
    );
    await check(
      'public PWA shell contains no signed-in operator data and assets remain available without a session',
      async () => {
        const manifest = await request('/offline-build.json', {
          cookieJar: null,
        });
        assert.equal(manifest.status, 200);
        const shell = await request(manifest.json.shell, { cookieJar: null });
        assert.equal(shell.status, 200);
        assert.ok(shell.text.includes('suntech-offline-root'));
        assert.ok(!shell.text.includes(fixture.cashier.userId));
        assert.ok(!shell.text.includes(fixture.cashier.email));
        const worker = await request('/suntech-sw.js', { cookieJar: null });
        assert.equal(worker.status, 200);
        assert.match(worker.headers.get('cache-control'), /no-cache|no-store/i);
        facts.publicShellAssetCount = manifest.json.assets.length;
      },
    );
    await check(
      'confirmed logout clears all auth cookies and the cashier session is rejected afterwards',
      async () => {
        const oldCookie = jar.header('/api/v1/orders');
        const result = await request('/api/v1/auth/logout', {
          method: 'POST',
          body: {},
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.data.serverLogoutConfirmed, true);
        for (const name of ['accessToken', 'suntech_session', 'refreshToken'])
          assert.equal(jar.has(name), false, `${name} survived logout`);
        assert.equal((await request('/api/session')).status, 401);
        assert.equal(
          (
            await request('/api/v1/orders', {
              cookieJar: null,
              headers: { cookie: oldCookie },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request('/api/v1/auth/login', {
              method: 'POST',
              body: loginBody,
            })
          ).status,
          200,
        );
      },
    );
    await check(
      'DELETE session clears every local auth cookie without claiming server logout',
      async () => {
        const originalAuth = jar.header('/api/v1/auth/logout');
        const result = await request('/api/session', { method: 'DELETE' });
        assert.equal(result.status, 200);
        for (const name of ['accessToken', 'suntech_session', 'refreshToken'])
          assert.equal(
            jar.has(name),
            false,
            `${name} survived session deletion`,
          );
        assert.equal((await request('/api/session')).status, 401);
        // Resolve this fixture's still-live server session using the preserved test cookie.
        const serverLogout = await request('/api/v1/auth/logout', {
          method: 'POST',
          body: {},
          cookieJar: null,
          headers: { cookie: originalAuth },
        });
        assert.equal(serverLogout.json.data.serverLogoutConfirmed, true);
        assert.equal(
          (
            await request('/api/v1/auth/login', {
              method: 'POST',
              body: loginBody,
            })
          ).status,
          200,
        );
      },
    );
    const beforeOutageCookies = jar.header('/api/v1/auth/logout');
    await stop(backend);
    await check(
      'backend outage becomes 503 without erasing the existing frontend session cookies',
      async () => {
        const result = await request('/api/v1/orders');
        assert.equal(result.status, 503);
        assert.equal(result.headers.getSetCookie().length, 0);
        assert.ok(jar.has('suntech_session'));
        assert.equal((await request('/api/session')).status, 200);
      },
    );
    await check(
      'local logout during backend outage reports uncertainty and expires every auth cookie',
      async () => {
        const result = await request('/api/v1/auth/logout', {
          method: 'POST',
          body: {},
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.data.serverLogoutConfirmed, false);
        for (const name of ['accessToken', 'suntech_session', 'refreshToken'])
          assert.equal(jar.has(name), false, `${name} survived offline logout`);
      },
    );
    await check(
      'local logout also expires auth cookies when the backend URL is not configured',
      async () => {
        const unconfigured = children(
          'frontend',
          [
            'node_modules/next/dist/bin/next',
            'start',
            '-H',
            '127.0.0.1',
            '-p',
            '4002',
          ],
          frontendRoot,
          {
            NODE_ENV: 'production',
            BACKEND_API_URL: '',
            SUNTECH_BACKEND_API_URL: '',
            SUNTECH_SESSION_SECRET: frontendSecret,
            NEXT_TELEMETRY_DISABLED: '1',
          },
        );
        const unconfiguredOrigin = 'http://localhost:4002';
        await waitHttp(
          `${unconfiguredOrigin}/api/session`,
          unconfigured,
          (status) => status === 401,
        );
        const response = await fetch(
          `${unconfiguredOrigin}/api/v1/auth/logout`,
          {
            method: 'POST',
            headers: {
              origin: unconfiguredOrigin,
              cookie: beforeOutageCookies,
              'content-type': 'application/json',
            },
            body: '{}',
          },
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.serverLogoutConfirmed, false);
        for (const name of ['accessToken', 'suntech_session', 'refreshToken'])
          assert.ok(
            response.headers
              .getSetCookie()
              .some(
                (cookie) =>
                  cookie.startsWith(`${name}=`) && /max-age=0/i.test(cookie),
              ),
            `${name} was not expired with missing configuration`,
          );
        await stop(unconfigured);
      },
    );
    const dbReport = JSON.parse(
      await fs.readFile(
        path.join(reportDirectory, 'local-first-db.json'),
        'utf8',
      ),
    );
    const report = {
      passed: cases.length,
      failed: 0,
      cases,
      ...facts,
      databaseChecks: dbReport.passed,
      postgres: dbReport.postgres,
      node: process.version,
      next: require(path.join(frontendRoot, 'node_modules/next/package.json'))
        .version,
    };
    await fs.writeFile(
      path.join(reportDirectory, 'full-stack-http.json'),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(
      `FULL-STACK HTTP: ${cases.length} passed; browser qualification remains separate.\n`,
    );
  } catch (error) {
    await fs.writeFile(
      path.join(reportDirectory, 'full-stack-http-failure.json'),
      JSON.stringify(
        {
          passedBeforeFailure: cases.length,
          cases,
          error: String(error),
          ...facts,
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(reportDirectory, 'full-stack-backend.log'),
      logs.backend,
    );
    await fs.writeFile(
      path.join(reportDirectory, 'full-stack-frontend.log'),
      logs.frontend,
    );
    throw error;
  } finally {
    for (const child of processes.reverse()) await stop(child);
    await fs.rm(fixturePath, { force: true });
  }
}
main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
