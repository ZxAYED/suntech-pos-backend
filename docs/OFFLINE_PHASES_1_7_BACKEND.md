# SunTech local-first backend: phases 1–7

This file describes the implemented backend contract. The main architecture guide remains `frontend/docs/offline/SUNTECH_POS_PWA_OFFLINE_MASTER_SDD.md`.

## What changed

Every new sale has one `clientOrderId`. The frontend saves that sale on the device before sending it here. An online checkout may first ask the server to check current prices. That check does not create an order or reserve a purchase ID.

The backend then processes each saved sale in one PostgreSQL transaction:

1. Claim its permanent purchase identity.
2. Check the original operator, branch, selected price policy and shift.
3. Write its stock changes and drawer cash changes.
4. Create the order and official order-line IDs.
5. Save the exact official receipt and acceptance warnings.
6. Commit everything together.

If step 5 fails, steps 1–4 roll back too. This was tested by adding a temporary PostgreSQL trigger that deliberately fails the receipt update.

If the response is lost after step 6, sending the same saved event returns `DUPLICATE` with the original official receipt. There is one financial effect.

**Names to learn:** atomic transaction, durable deduplication, immutable event, idempotency, canonical SHA-256 fingerprint, optimistic concurrency, per-item acknowledgment, scoped authorization, signed capability, replay protection.

## Existing APIs

The old order routes remain available: `/orders/catalog`, `/orders/custom`, `/orders`, and `/orders/sync`. Payroll, advances, expenses, refunds, reports, catalog editing, staff management, and authentication routes keep their existing contracts.

These deliberate corrections preserve the existing business rules:

- Admin v1 sync now forwards the selected business and branch into the actual order writer. Previously the outer batch had the scope but the writer did not receive it.
- A zero clock-skew tolerance stays zero. Previously `Number(value) || 300` silently changed zero to five minutes.
- An unresolved legacy idempotency record is no longer deleted after 24 hours. A lost server response is not proof that the sale failed. Unexpected server errors also keep that recovery record. Confirmed input/permission failures can release the request lock, while the purchase stays associated with its original protocol.
- The real HTTP validation pipe now knows that each `orders` array entry is a sale object. Without `@Type(() => SyncOrderItemDto)`, the existing global implicit-conversion setting changed sale objects into empty arrays before the v1 service received them. V2 uses the corresponding explicit type. Each sale is still validated independently, so one bad event does not reject all good events. This is **nested DTO transformation**, also called deserialization.
- The global error wrapper preserves the safe `PRICE_CHANGED` code, original variant ID and current/submitted price fields. Previously it kept only the human-readable message, preventing the frontend from reliably choosing its correction flow. Private exception internals are still excluded.

Whole-BDT tender values also reject overflow before entering a financial transaction. PostgreSQL integer money fields can store at most 2,147,483,647.

## New endpoints

All paths below are under `/api/v1`. They use the existing live authentication and Admin/Cashier role guards.

| Method and path                       | Purpose                                                                                          | Financial effects                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `POST /offline/provision`             | Enroll this operator/device/branch and return a signed permission plus complete catalog snapshot | No sale effects                   |
| `GET /offline/bootstrap?deviceId=...` | Refresh complete catalog, stock reconciliation IDs and recent operator history                   | None                              |
| `POST /orders/sync-v2/validate`       | Check current scope, live prices, tender and selected shift before online local commit           | None                              |
| `POST /orders/sync-v2`                | Post saved immutable local events, at most 100 per request                                       | One transaction per accepted sale |
| `POST /orders/sync-v2/status`         | Find already accepted original IDs for this operator/device/branch                               | None                              |
| `GET /orders/legacy-status/:key`      | Read the original legacy request's recovery state                                                | None                              |

There is **no total offline-sale count cap**. A queue of 1,257 sales uses repeated requests. The HTTP request maximum of 100 is a batch size.

Signed permission tokens make a normal batch larger than Express's default 100 KB JSON limit. Only `/orders/sync-v2` and its subpaths use a 4 MB JSON parser. The other APIs keep their previous request-size bound. If a request is too large, HTTP 413 with `REQUEST_TOO_LARGE` tells the client to split the batch while preserving every original sale ID. A single event exceeding the real request-size bound needs review; it must not be deleted or assigned a replacement identity.

### Provision

Request:

```json
{
  "deviceId": "browser-generated-UUID",
  "businessId": "selected-business",
  "locationId": "selected-branch"
}
```

Cashier scope is checked against the current server assignment. Admin scope must be owned by that Admin. The response contains `grantToken`, `claims`, `verificationKey: {kid, jwk}`, and `bootstrap`.

The grant is an ES256 compact JWS. Its signature uses ECDSA P-256 with a SHA-256 digest and a 64-byte P1363 signature, which browser Web Crypto verifies directly. Claims include `version`, `iss`, `aud`, `jti`, `sub`, `userId`, `businessId`, `locationId`, `deviceId`, `role`, `iat`, `exp`, `permissions`, `offlineIntakeAllowed`, `capturedPriceAllowed`, and `closedShiftPolicy`.

This is a selling permission. It is not a replacement login token and is never accepted as the API's authentication cookie.

### Complete snapshot

The v2 snapshot includes:

- Existing nested `categories` plus a complete flat `products` list. The flat list includes active products that have no category.
- Real variants, barcodes, manual payment methods, and selected branch stock, including negative values.
- A `manifest` with version 2, snapshot ID, exact scope, product/variant/category counts, and `complete: true`.
- `acceptedClientOrderIds` for every accepted sale from the original operator/device/branch, in the same repeatable-read database snapshot as stock, with `acceptedIdsComplete: true`.
- Recent original-operator order history, capped at 100 records and clearly marked `history.complete: false`. This is recent-history coverage, not a completed-sales queue cap.

The complete accepted-ID set lets the browser stop subtracting a sale that the refreshed server stock already includes. Otherwise, stock 10 minus a sale of 2 could incorrectly become 6 after the server already reports 8.

**Scaling limit:** this initial snapshot is one response. Its accepted-ID list and full catalog grow with the business. Measure payload size on real tills; a future paged snapshot protocol must preserve one consistent snapshot generation. Do not simply truncate the ID list, because that would corrupt stock estimates.

### Read-only current-price check

Send the same scope and sale fields, without `clientOrderId`, `grantToken` or `pricePolicy`: `userId` is optional, `orderType`, `paymentMethod`, `tenderedAmount`, `shiftId`, `lines`, and optional customer/notes fields.

Success returns `{valid: true, pricePolicy: "CURRENT_PRICE", serverTime: "..."}`. A changed catalog price returns the existing HTTP 409 `PRICE_CHANGED` shape with `variantId`, `submittedPrice` and `currentPrice` so the existing correction UI can work.

Final sync checks the price again. If a price changes between preflight and posting, the immutable saved sale goes to review. The server does not change the customer's recorded payment or create a replacement purchase.

### Sync v2

```json
{
  "deviceId": "original-device",
  "businessId": "original-business",
  "locationId": "original-branch",
  "orders": [
    {
      "clientOrderId": "4fa2bf6c-6cf0-4dd2-b9ed-0ef612d23598",
      "userId": "original-seller",
      "orderType": "CATALOG",
      "occurredAt": "2026-11-24T18:00:00+06:00",
      "shiftId": null,
      "paymentMethod": "COD",
      "tenderedAmount": 200,
      "pricePolicy": "CURRENT_PRICE",
      "grantToken": "original.signed.permission",
      "lines": [
        { "variantId": "actual-variant-id", "quantity": 2, "unitPrice": 100 }
      ]
    }
  ]
}
```

Each result contains `clientOrderId`, `status`, `retryable`, `warnings`, and, when accepted or duplicated, `orderId`, `invoiceNumber` and the full official `order`. Rejections add `code` and `error`.

HTTP 200 means the result list is available. It does **not** mean every item was accepted.

| Result                                                             | Frontend action                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ACCEPTED` or `DUPLICATE` with a matching complete official order  | Persist acknowledgment and mapping in IndexedDB                                 |
| `REJECTED`, `retryable: true`                                      | Keep the same ID and retry later                                                |
| `PRICE_CHANGED`, `SYNC_PAYLOAD_MISMATCH`, `SYNC_IDENTITY_CONFLICT` | Keep the paid event and send it to review                                       |
| `ORIGINAL_OPERATOR_REQUIRED`, grant/scope/revocation codes         | Keep the event and require the correct authorized operator or approved recovery |
| Missing, malformed or lost result                                  | Keep uncertainty; resend the same event                                         |

`CURRENT_PRICE` follows existing live catalog price and availability checks. `CAPTURED_PRICE` is accepted only when the original signed permission explicitly allows it. Adding a `clientOrderId` alone never enables historical pricing.

For v2, a missing/deleted real variant returns `ITEM_UNAVAILABLE_REVIEW_REQUIRED` before any order, stock or cash effect. The local paid event remains intact. This avoids accepting an order with a null variant mapping that the device cannot reconcile. The old v1 captured-sale route retains its existing unavailable-variant behavior. A future approved archived-item posting workflow must keep the original variant evidence; it must not invent a replacement ID.

`shiftId: null` means no shift attachment. A closed selected shift uses the signed policy: `REVIEW`, or an explicitly configured `DETACH_WITH_WARNING`. Old shifts are never reopened automatically.

### Delayed upload

The sale's `occurredAt` must be inside its original grant's `[iat, exp)` interval. Upload may happen after `exp`: expiry controls new selling, not retention or replay. A real database test posts a 30-day-old original event and verifies its occurrence date is preserved while its posting date is current.

The uploader currently must be the original seller. Signing in as another Admin does not change the original seller or authorize recovery automatically. A manager recovery workflow for an absent/revoked cashier remains a separate business-policy decision and future feature.

### Legacy recovery and mixed clients

New local events use v2 only. Old uncertain requests keep their original path and key.

`FinancialSaleIdentity` is a permanent UUID registry shared by legacy sale routes and v2. If old and new clients accidentally race with the same ID, only one protocol can own it. The other gets a review response. This was tested concurrently against PostgreSQL.

Legacy status returns `UNKNOWN`, `CONFIRMED`, or `NOT_FOUND`, always with `canCreateReplacement: false`. An absent old idempotency row does not prove that a pre-upgrade financial operation never committed. The new endpoint reports evidence; it does not fabricate that missing proof.

## Database migration

`20261124000000_local_first_protocol` is additive. It creates `OfflineDevice`, `OfflineGrant`, and `FinancialSaleIdentity`, and adds `syncProtocol`, `syncReceipt`, and `syncWarnings` to `Order`.

Apply normal reviewed migrations before starting the new backend:

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
```

This task ran migrations only in a disposable local PostgreSQL database. It did not connect to or migrate a production database.

Do not drop the added tables/columns during rollback. Old IDs, grants, receipts and queues must stay recoverable.

For an intake rollback, disable the frontend's `NEXT_PUBLIC_OFFLINE_INTAKE` flag and stop issuing new grants as needed. Keep the v2 backend replay/status endpoints running while saved v2 events remain. Deploying an older backend that lacks those endpoints would pause recovery; sending those events through the old catalog/custom routes would risk a second purchase and is forbidden.

## Server setup and policy switches

The supplied `.env.example` lists each setting. No private production key or guessed offline lifetime is included.

1. Generate a private EC P-256 signing key with `node scripts/generate-offline-signing-key.cjs /private/path/offline-key.env`. This refuses to overwrite an existing key.
2. Load its `OFFLINE_SIGNING_PRIVATE_KEY_BASE64` into the backend environment. Keep it outside the source repository.
3. Leave `OFFLINE_GRANT_TTL_SECONDS` blank or zero for online-only credentials. Their five-minute validity is a short online preflight credential, not an approved outage duration.
4. Set a positive offline lifetime only when the business approves it.
5. Set `OFFLINE_CAPTURED_PRICE_ENABLED=true` only when captured historical prices are approved. Otherwise those events cannot post silently.
6. Decide whether closed shifts need `REVIEW` or `DETACH_WITH_WARNING`.
7. Preserve old public keys in `OFFLINE_VERIFICATION_KEYS_JSON` when rotating signing keys. Old original grants still need verification.
8. `OFFLINE_NEW_INTAKE_ENABLED=false` prevents new permission issuance. It does not erase saved events or disable replay/status endpoints. A disconnected device learns about revocation only when it reconnects or its existing permission expires.

Before real paid offline operation, also approve the encrypted backup location, key custodian, backup schedule, supported device/printer list, and recovery owner. This implementation cannot restore payment events from a destroyed device if no independent backup was made.

## Regression commands

```sh
npm test -- --runInBand
npm run build
node scripts/test-local-first-db.cjs
node scripts/test-full-stack-http.cjs
```

The last command creates its own temporary PostgreSQL database and never reads a production `DATABASE_URL`. It applies all migrations and exercises actual production service classes and database transactions. It runs on a non-root account; its embedded PostgreSQL package needs a supported platform binary. The test uses TCP-only localhost so it works where Unix-domain sockets are unavailable.

`test-full-stack-http.cjs` requires a built sibling `frontend` directory (or `SUNTECH_FRONTEND_DIR`). It starts the database fixture, real Nest backend and production Next.js server as child processes in the same environment, then tests actual BFF cookies, price errors, order upload/replay, body limits, legacy responses and logout/outage behavior. It is HTTP integration coverage; it does not claim that a browser installed or cold-started the PWA.

`node scripts/test-local-first-db.cjs --serve` additionally leaves a disposable Nest backend on port 4000 for frontend integration tests. Ephemeral test credentials are written outside this repository to `integration/test-runtime/backend-fixture.json`; never include that file in a release archive.

The actual database checks cover concurrent duplicates, response-loss replay, changed payload, price races, negative stock, manual bank payment, optional shift, receipt-write rollback, 101 sales over multiple requests, complete stock acknowledgment coverage, Admin branch scope, old v1 compatibility, mixed legacy/v2 concurrency, a 30-day backlog, and restart durability.

Passing local tests is evidence for these cases. Physical printer behavior, deployed HTTPS caching, browsers/devices used by the shop, long-outage disk capacity, and production policies still require the release checklist in the master guide.
