# Suntech POS: Backend Implementation Tracker

This document matches the API that is implemented today. Successful responses are wrapped in the envelope below. Examples show the inner `data` object unless stated otherwise.

## 1. Global architecture

* [x] **Exception filter.** Controllers do not catch errors. `GlobalExceptionFilter` returns `{ success: false, message, timestamp }`. Unexpected errors become `"Internal server error"`.
* [x] **Response envelope.** `TransformInterceptor` wraps successes as `{ success: true, message, data, timestamp }`.
* [x] **Idempotency.** Routes marked below with `Idempotency-Key` require that header (max 200 characters). The first success is stored for 24 hours and replayed. The same key on a different path returns 409. A key still in progress returns 409. Replays do not run the handler again.
* [x] **Rate limits.** Every route allows 60 requests per minute. `/auth/*` allows 5 requests per minute.
* [x] **Tenant scope.** Business, location, staff, advance, payroll, and variant-image operations require `businessId` from the JWT. A row in another business is a 404.
* [x] **Soft delete.** Reads of users, businesses, locations, advances, and variants ignore rows with `deletedAt` set. Payroll records are not soft-deleted.
* [x] **Integer money.** Currency fields are integers (smallest currency unit). Payroll may store a negative `netPaid` when advances exceed salary.
* [x] **Salary masking.** If the caller is a cashier, `monthlySalary` is removed from every response, including nested objects. Advance summaries use `baseSalary`, so a cashier still sees their own pay figure there.
* [x] **Images.** JPEG, PNG, or WebP, 5 MB max. Cloudinary public ids are stored for deletion and are never returned.

## 2. Identity

* [x] Public ids look like `ADM-8X9B2` and `CSH-K9P1Z` (no `0`, `O`, `1`, or `I`). Collisions retry up to 3 times.
* [x] `POST /auth/register` creates an `ADMIN` in `PENDING_APPROVAL` with no `publicId`. Login stays closed until a super admin approves the account.
* [x] `ADMIN` login uses email. `BUSINESS_USER` login uses `publicId`. The wrong mode returns 403 `"Invalid login mode"`. Only `ACTIVE` accounts can sign in.
* [x] Admin access tokens include `businessId` after a business exists. Cashier tokens include `publicId`, `businessId`, and `locationId`.
* [x] Password reset emails a 6-digit code, stores a bcrypt hash, and expires the code after 15 minutes. The reset token lasts 10 minutes.

## 3. Tenancy and staff

* [x] Creating a business sets `ownerId` and the admin's `businessId`, then returns a new access token. One business per owner.
* [x] Locations are created from the JWT `businessId`. The client cannot choose a business id.
* [x] Cashier creation checks that the location belongs to the admin's business, mints a `CSH-` id, and sets `ACTIVE`. A missing email is stored internally and returned as `email: null`.
* [x] `PATCH /users/:id/status` accepts `ACTIVE`, `SUSPENDED`, or `REJECTED`, and only for users in the same business.

## 4. HR and payroll

* [x] Cashiers and admins can record a pending advance. A cashier's `cashierId` is always their own user id. Cashiers cannot delete advances (403).
* [x] Admins soft-delete an advance in their business. The response includes `deletedAt`.
* [x] `GET /advances/summary` sums pending, non-deleted advances whose `takenAt` falls in the UTC month. `netPayable = baseSalary - totalPendingAdvances`.
* [x] `POST /payroll/process` runs in one Prisma `$transaction`. A second run for the same cashier, month, and year returns 409 and does not leave advances deducted. Zero advances are valid.
* [x] `GET /payroll` lists that business's payroll rows for a month.

## 5. Shifts and catalog

* [x] Cashiers open one shift at a time and close it with a counted closing amount. `businessId` and `locationId` come from the JWT.
* [x] Admins create, list, read, update, and soft-delete categories, products, and variants inside their business.
* [x] Omitting a variant SKU mints `PRD-` plus six unambiguous characters. A duplicate SKU or barcode returns 409.
* [x] Soft-deleting a product hides its variants from catalog reads.

## 6. Checkout and refunds

* [x] `POST /orders` sells catalog variants and custom items in one transaction. Catalog prices come from `Variant.sellingPrice`. Stock may go negative. A cashier needs an open shift.
* [x] `POST /orders/:id/refunds` is admin-only. It refuses a quantity above what is still unrefunded, restores catalog stock, and returns `PARTIALLY_REFUNDED` or `REFUNDED`.
* [x] `GET /orders` lists the business's receipts. Orders have no `businessId` column, so the business filter uses the cashier's `businessId`. Refund status is calculated. It is not stored on `Order`.

## 7. Analytics and branded reports

* [x] `GET /reports/dashboard` returns cashier totals or admin totals, including a staff leaderboard, from the caller's role.
* [x] `GET /reports/transactions` is admin-only and lists the business's orders with items and the cashier.
* [x] `GET /reports/export` is admin-only and streams a payroll or sales CSV or PDF for one UTC month.
* [x] Revenue subtracts refunds. Totals stay inside `businessId`. A month with no rows still produces a PDF.

`Order`, `Refund`, and `StockTransaction` have no `businessId` column. Checkout, refunds, and sales reports reach a business through the cashier and the variant. Category names, product names, SKUs, and barcodes are unique across the whole database, so a code already used by another business (or by a soft-deleted row) still returns 409.

---

# Frontend API guide

**Base URL:** `/api/v1`

**Swagger Documentation:** `/api/docs`

**Auth header:** `Authorization: Bearer <accessToken>`

**Idempotency header:** `Idempotency-Key: <client-generated-uuid>`

Send it only on the routes that list it. Image uploads and advance deletion are not idempotent.

**Success:**

```json
{
  "success": true,
  "message": "Human readable success message",
  "data": {},
  "timestamp": "2026-10-07T14:10:00.000Z"
}
```

**Error:**

```json
{
  "success": false,
  "message": "Error reason",
  "timestamp": "2026-10-07T14:10:00.000Z"
}
```

## Enums

```typescript
enum Role { SUPER_ADMIN = 'SUPER_ADMIN', ADMIN = 'ADMIN', CASHIER = 'CASHIER' }
enum AccountStatus { PENDING_APPROVAL = 'PENDING_APPROVAL', ACTIVE = 'ACTIVE', REJECTED = 'REJECTED', SUSPENDED = 'SUSPENDED' }
enum LoginType { ADMIN = 'ADMIN', BUSINESS_USER = 'BUSINESS_USER' }
enum AdvanceStatus { PENDING = 'PENDING', DEDUCTED = 'DEDUCTED' }
enum PayrollStatus { DUE = 'DUE', PAID = 'PAID' }
enum PaymentType { COD = 'COD', BKASH = 'BKASH', NAGAD = 'NAGAD', BANK = 'BANK' }
enum PaymentMethod { COD = 'COD', BKASH = 'BKASH', NAGAD = 'NAGAD', BANK = 'BANK' }
enum OrderType { CATALOG = 'CATALOG', CUSTOM = 'CUSTOM' }
enum OrderStatus { PENDING = 'PENDING', PAID = 'PAID', CANCELLED = 'CANCELLED', REFUNDED = 'REFUNDED' }
```

Payroll processing always writes `PAID`. Payment types are pure enums (`COD`, `BKASH`, `NAGAD`, `BANK`) without external payment gateway or intent overhead.

## Shared user object

Login, register, and approval return this shape. `email` is `null` on login when the account uses an internal cashier address.

```json
{
  "id": "cuid",
  "publicId": "ADM-8X9B2",
  "fullName": "John Doe",
  "email": "john@example.com",
  "phoneNumber": null,
  "role": "ADMIN",
  "status": "PENDING_APPROVAL",
  "businessId": null,
  "locationId": null,
  "profileImageUrl": null
}
```

`GET /users/me`, cashier creation, and status updates add `statusReason` and `monthlySalary`. Cashiers do not receive `monthlySalary`.

---

## 1. Authentication (`/auth`)

All of these routes are limited to 5 requests per minute. Passwords are 8–72 characters. `phoneNumber`, when sent, is 8–20 characters.

### Register admin

* **POST** `/auth/register`
* **Headers:** `Idempotency-Key`
* **Body:** `{ "fullName": "John Doe", "email": "john@example.com", "password": "secure123", "phoneNumber": "1234567890" }`
* `phoneNumber` is optional.
* **Data:** the shared user object with `role: "ADMIN"`, `status: "PENDING_APPROVAL"`, and `publicId: null`.
* Login is rejected with 403 `"Account is pending approval"` until approval.

### Approve admin

* **PATCH** `/admin/users/:id/approve`
* **Who:** `SUPER_ADMIN`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Data:** the shared user object with `status: "ACTIVE"` and a new `publicId` such as `ADM-8X9B2`.
* 409 if the user is not an admin waiting for approval.

### Login

* **POST** `/auth/login`
* **Admin body:** `{ "loginType": "ADMIN", "email": "john@example.com", "password": "secure123" }`
* **Cashier body:** `{ "loginType": "BUSINESS_USER", "publicId": "CSH-A1B2C", "password": "secure123" }`
* **Data:**

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "user": { "id": "...", "publicId": "CSH-A1B2C", "role": "CASHIER", "businessId": "...", "locationId": "...", "profileImageUrl": null }
}
```

* Wrong mode: 403 `"Invalid login mode"`. Unknown account or bad password: 401. Suspended or rejected: 403 `"Account is not active"`.
* `SUPER_ADMIN` uses `loginType: "ADMIN"`.

### Refresh

* **POST** `/auth/refresh`
* **Body:** `{ "refreshToken": "eyJhbG..." }`
* **Data:** `{ "accessToken": "eyJhbG..." }`
* The refresh token itself is not rotated.

### Password recovery

1. **POST** `/auth/forgot-password`
   * **Body:** `{ "loginType": "ADMIN", "identifier": "john@example.com" }`
   * Cashiers send `loginType: "BUSINESS_USER"` and their `publicId` as `identifier`.
   * **Data:** `{ "accepted": true }`
   * Unknown account: 404 `"Account not found"`.
2. **POST** `/auth/verify-otp`
   * **Body:** `{ "loginType": "ADMIN", "identifier": "john@example.com", "otp": "123456" }`
   * **Data:** `{ "resetToken": "temp-jwt" }`
3. **POST** `/auth/reset-password`
   * **Headers:** `Idempotency-Key`
   * **Body:** `{ "resetToken": "temp-jwt", "newPassword": "new-secure-password" }`
   * **Data:** `{ "updated": true }`

---

## 2. Tenancy (`/tenant`)

**Who:** `ADMIN`. A missing `businessId` on location or image routes returns 403 `"Create a business before adding locations"` or `"Create a business before uploading an image"`.

### Create business

* **POST** `/tenant/business`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Body:** `{ "name": "SuperMart" }`
* **Data:**

```json
{
  "business": {
    "id": "...",
    "name": "SuperMart",
    "ownerId": "...",
    "profileImageUrl": null,
    "deletedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "accessToken": "new-jwt-with-businessId"
}
```

Replace the stored access token with `accessToken`. A second business returns 409 `"You already have a business"`.

### Business profile image

* **POST** `/tenant/business/profile-image`
* **Body:** multipart field `file`
* **Data:** the business object, including `profileImageUrl`. Cloudinary ids are not included.
* **DELETE** `/tenant/business/profile-image` clears it and returns the same business shape with `profileImageUrl: null`.

### Create location

* **POST** `/tenant/locations`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Body:** `{ "name": "Downtown Branch", "address": "123 Main St" }`
* `address` is optional.
* **Data:** `{ "id": "...", "name": "Downtown Branch", "address": "123 Main St", "businessId": "..." }` plus `deletedAt`, `createdAt`, and `updatedAt`.

---

## 3. Users (`/users`)

### Current profile

* **GET** `/users/me`
* **Who:** any signed-in user
* **Data:** shared user fields plus `statusReason` and, for admins only, `monthlySalary`.

### Own profile image

* **POST** `/users/me/profile-image` with multipart field `file`
* **DELETE** `/users/me/profile-image`
* **Who:** any signed-in user
* **Data:** the current profile, with `profileImageUrl` set or `null`.

### Provision cashier

* **POST** `/users/cashiers`
* **Who:** `ADMIN`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Body:**

```json
{
  "fullName": "Jane Smith",
  "password": "tempPassword123",
  "locationId": "loc-123",
  "monthlySalary": 20000,
  "email": "jane@optional.com",
  "phoneNumber": "12345678"
}
```

* `email` and `phoneNumber` are optional. `monthlySalary` is an integer of at least 1.
* **Data:** the profile, with `publicId` like `CSH-X8T2P`, `status: "ACTIVE"`, and `email: null` when no email was sent.
* A location outside the business is 404 `"Location not found"`.

### Staff profile image

* **POST** `/users/:id/profile-image` with multipart field `file`
* **DELETE** `/users/:id/profile-image`
* **Who:** `ADMIN`, and only for a user in the same business.

### Change status

* **PATCH** `/users/:id/status`
* **Who:** `ADMIN`
* **Body:** `{ "status": "SUSPENDED", "statusReason": "Taking leave" }`
* `status` is `ACTIVE`, `SUSPENDED`, or `REJECTED`. `statusReason` is optional, max 240 characters.
* No `Idempotency-Key`.
* **Data:** the updated profile. Unknown user or another business: 404.

---

## 4. Advances and payroll

Month is 1–12. Year is 2000–2100. The month window is UTC, from the first instant of the month up to, but not including, the next month.

### Create advance

* **POST** `/advances`
* **Who:** `ADMIN` or `CASHIER`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Body:** `{ "amount": 500, "reason": "Emergency", "cashierId": "user-123" }`
* `amount` is an integer of at least 1. `reason` is optional, max 500 characters.
* A cashier may omit `cashierId`. If they send one, it is ignored and the advance is stored for themselves.
* An admin must send `cashierId` for a cashier in their business. 400 `"cashierId is required"` when it is missing. 404 `"Cashier not found"` when that cashier is outside the business.
* **Data:**

```json
{
  "id": "...",
  "cashierId": "user-123",
  "amount": 500,
  "reason": "Emergency",
  "status": "PENDING",
  "takenAt": "2026-10-07T08:10:00.000Z",
  "createdAt": "2026-10-07T08:10:00.000Z"
}
```

### Delete advance

* **DELETE** `/advances/:id`
* **Who:** `ADMIN`. Cashiers receive 403 `"You do not have permission to perform this action"`.
* **Data:** `{ "id": "...", "deletedAt": "2026-10-07T14:10:00.000Z" }`
* Another business, or an already deleted row: 404 `"Advance not found"`.

### Advance summary

* **GET** `/advances/summary?cashierId=user-123&month=10&year=2026`
* **Who:** `ADMIN` or `CASHIER`
* Cashiers may omit `cashierId`. Another cashier's id returns 403 `"You can only view your own advances"`.
* Admins must pass `cashierId`.
* **Data:**

```json
{
  "history": [
    {
      "id": "...",
      "cashierId": "user-123",
      "amount": 500,
      "reason": "Emergency",
      "status": "PENDING",
      "takenAt": "2026-10-02T00:00:00.000Z",
      "createdAt": "2026-10-02T00:00:00.000Z"
    }
  ],
  "summary": {
    "baseSalary": 20000,
    "totalPendingAdvances": 500,
    "netPayable": 19500
  }
}
```

Only `PENDING` advances with `deletedAt: null` in that UTC month are included. `netPayable` can be negative.

### Process payroll

* **POST** `/payroll/process`
* **Who:** `ADMIN`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Body:** `{ "cashierId": "user-123", "month": 10, "year": 2026 }`
* **Data:**

```json
{
  "id": "pay-123",
  "cashierId": "user-123",
  "month": 10,
  "year": 2026,
  "baseSalary": 20000,
  "totalAdvancesDeducted": 500,
  "netPaid": 19500,
  "status": "PAID",
  "createdAt": "2026-10-07T14:10:00.000Z",
  "cashier": { "id": "user-123", "fullName": "Jane Smith", "publicId": "CSH-X8T2P" }
}
```

Pending advances in that month become `DEDUCTED`. A repeat for the same cashier and period returns 409 `"Payroll for this cashier and period already exists"`. Replaying the same `Idempotency-Key` returns the original success instead of 409.

### Payroll history

* **GET** `/payroll?month=10&year=2026`
* **Who:** `ADMIN`
* **Data:** an array of the payroll objects shown above, for this business only.

---

## 5. Shifts (`/shifts`)

**Who:** `CASHIER`. Both writes require `Idempotency-Key`. Amounts are integers of at least 0. `businessId` and `locationId` are taken from the token, never from the body.

### Open

* **POST** `/shifts/open`
* **Body:** `{ "startingAmount": 5000 }`
* **Data:** `{ "id", "businessId", "locationId", "cashierId", "startingAmount", "closingAmount": null, "status": "OPEN", "openedAt", "closedAt": null }`
* A second open shift returns 409 `"You already have an open shift"`.
* A cashier with no location returns 403.

### Close

* **POST** `/shifts/:id/close`
* **Body:** `{ "closingAmount": 4800 }`
* **Data:** the same shift object with `status: "CLOSED"`, `closingAmount`, and `closedAt`.
* Another cashier's shift, or another business, is 404 `"Shift not found"`.
* Closing it twice returns 409 `"This shift is already closed"`.

---

## 6. Catalog (`/catalog`)

**Who:** `ADMIN`. Every query uses the token `businessId` and ignores soft-deleted rows. Creates require `Idempotency-Key`. Deletes return `{ "id", "deletedAt" }`.

### Categories

* **POST** `/catalog/categories` — `{ "name": "Shirts", "description": "Optional" }`
* **GET** `/catalog/categories` and **GET** `/catalog/categories/:id`
* **PATCH** `/catalog/categories/:id` — any of `name`, `description`
* **DELETE** `/catalog/categories/:id`
* A live category with the same name in this business returns 409 `"A category with that name already exists"`.
* Category data includes `_count.products` for products that are not deleted.

### Products

* **POST** `/catalog/products` — `{ "name": "Tee", "description": "Optional", "categoryId": "optional" }`
* **GET** `/catalog/products` and **GET** `/catalog/products/:id`
* **PATCH** `/catalog/products/:id` — `name`, `description`, and `categoryId` (`null` clears the category)
* **DELETE** `/catalog/products/:id` hides the product and its variants from later reads. The variant rows stay in the database with their own `deletedAt` unchanged.
* A category outside the business is 404 `"Category not found"`.
* A duplicate live name returns 409 `"A product with that name already exists"`.
* Product data includes `category: { id, name } | null` and `variants` that are not soft-deleted. Each variant includes `id`, `name`, `sku`, `barcode`, `sellingPrice`, `costPrice`, `stock`, and `profileImageUrl`.

### Variants

* **POST** `/catalog/variants`

```json
{
  "productId": "product-123",
  "name": "Red / M",
  "sku": "TEE-RED-M",
  "barcode": "123456789012",
  "sellingPrice": 1500,
  "costPrice": 800,
  "stock": 12
}
```

* `sku`, `barcode`, `costPrice`, and `stock` are optional. `stock` defaults to 0. Prices are integers of at least 0.
* When `sku` is omitted, the server assigns `PRD-` plus six characters.
* **GET** `/catalog/variants` and **GET** `/catalog/variants/:id` omit variants whose product was soft-deleted.
* **PATCH** `/catalog/variants/:id` — any create field. `barcode: null` or `costPrice: null` clears that value.
* **DELETE** `/catalog/variants/:id`
* A duplicate SKU or barcode returns 409 `"A variant with that SKU or barcode already exists"`.
* A product outside the business is 404 `"Product not found"`.
* Variant data also includes `images: [{ id, url, sortOrder }]`. Cloudinary public ids are not included.

---

## 7. Variant images (`/variants`)

**Who:** `ADMIN` with a business. The variant must belong to that business. Create the variant with `/catalog/variants` first.

* **POST** `/variants/:variantId/profile-image` — multipart field `file`. **Data:** `{ "profileImageUrl": "https://..." }`
* **DELETE** `/variants/:variantId/profile-image` — **Data:** `{ "profileImageUrl": null }`
* **GET** `/variants/:variantId/images` — **Data:** `[{ "id": "...", "url": "https://...", "sortOrder": 0, "createdAt": "..." }]`
* **POST** `/variants/:variantId/images` — multipart field `images`, up to 8 files. A variant holds at most 10 gallery images.
* **DELETE** `/variants/:variantId/images/:imageId` — returns the remaining gallery.

A missing or foreign variant is 404 `"Variant not found"`.

---

## 8. Orders (`/orders`)

All orders are stored in a single unified schema with `orderType: "CATALOG" | "CUSTOM"`.
Money fields are integers (in cents / paisa). Creates require `Idempotency-Key`.
Supported payment types are pure enums: `COD`, `BKASH`, `NAGAD`, `BANK` (default: `COD`). Both `paymentMethod` and `paymentType` are accepted in request payloads.

Interactive OpenAPI / Swagger UI documentation is available at `/api/docs`.

### 1. Catalog checkout (`POST /orders/catalog`)

* **Who:** `CASHIER`, `ADMIN`, or `SUPER_ADMIN`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Description:** Standard checkout for enlisted catalog variants. Validates inventory and decrements stock in a transaction.
* **Body:**

```json
{
  "locationId": "loc-uuid-123",
  "shiftId": "shift-uuid-456",
  "tenderedAmount": 3000,
  "paymentMethod": "BKASH",
  "customerName": "Rahim Khan",
  "customerPhone": "01711111111",
  "notes": "Fragile items",
  "lines": [
    {
      "variantId": "var-uuid-789",
      "quantity": 2,
      "unitPrice": 1500
    }
  ]
}
```

* `paymentMethod` / `paymentType`: Optional enum (`COD`, `BKASH`, `NAGAD`, `BANK`), defaults to `COD`.
* `tenderedAmount`: Integer money, must be `>= totalAmount`.
* `lines`: Array of items. `quantity` >= 1. `unitPrice` is in integer cents.
* `customerName`, `customerPhone`, `notes`, `shiftId`: Optional. If cashier omits `shiftId`, their active open shift is auto-resolved.
* Decrements variant stock and records `SALE` transactions.
* **Response `data`:** Unified order with `invoiceNumber` (`INV-YYYYMMDD-XXXX`), `orderType: "CATALOG"`, `status: "PAID"`, `paymentMethod: "BKASH"`, `subtotal`, `totalAmount`, `tenderedAmount`, `changeDue`, and order `lines`.

### 2. Custom ad-hoc checkout (`POST /orders/custom`)

* **Who:** `CASHIER`, `ADMIN`, or `SUPER_ADMIN`
* **Headers:** `Authorization`, `Idempotency-Key`
* **Description:** High-velocity manual checkout for unlisted products, quick repairs, and ad-hoc gadget sales. Bypasses catalog variant lookup and inventory stock decrement.
* **Body:**

```json
{
  "locationId": "loc-uuid-123",
  "shiftId": "shift-uuid-456",
  "tenderedAmount": 1000,
  "paymentMethod": "NAGAD",
  "customerName": "Karim Ahmed",
  "customerPhone": "01822222222",
  "notes": "Screen protector installation",
  "lines": [
    {
      "productName": "Screen Protector Glass",
      "variantName": "Matte Finish",
      "unitPrice": 500,
      "quantity": 2
    }
  ]
}
```

* `paymentMethod` / `paymentType`: Optional enum (`COD`, `BKASH`, `NAGAD`, `BANK`), defaults to `COD`.
* `lines`: Requires `productName` (string), `unitPrice` (integer), `quantity` (integer >= 1). `variantName` is optional.
* No inventory stock validation or decrement occurs.
* If a shift is linked, updates `cashCollected` for cash reconciliation.
* **Response `data`:** Unified order with `invoiceNumber` (`INV-YYYYMMDD-XXXX`), `orderType: "CUSTOM"`, `status: "PAID"`, `paymentMethod: "NAGAD"`, `lines` with `variantId: null`, `productName`, `subtotal`.

### 3. Unified order history (`GET /orders`)

* **Who:** `CASHIER`, `ADMIN`, or `SUPER_ADMIN`
* **Query Parameters:**
  * `locationId` (string, optional): Filter by location UUID.
  * `orderType` (enum, optional): `CATALOG` or `CUSTOM`.
  * `page` (number, default: 1).
  * `limit` (number, default: 20, max: 100).
* **Data:** `{ "items": [...], "page": 1, "limit": 20, "total": 1 }`
* Each order item contains `id`, `invoiceNumber`, `receiptNumber`, `orderType`, `status`, `paymentMethod`, `subtotal`, `totalAmount`, `tenderedAmount`, `changeDue`, `customerName`, `customerPhone`, `lines`, `createdAt`.

### 4. Legacy checkout (`POST /orders`)

* Backwards-compatible route for legacy clients. Automatically handled.

### 5. Refund (`POST /orders/:id/refunds`)

* **Who:** `ADMIN`
* **Body:** `{ "reason": "Wrong size", "items": [{ "orderItemId": "line-1", "quantity": 1 }] }`
* `reason` is optional. Each order item may appear once. `quantity` is an integer of at least 1.
* The refund amount is `stored price × quantity`. A request above the quantity not yet refunded returns 409 `"Refund quantity exceeds the remaining quantity"`.
* Catalog lines increment stock and write a `REFUND` stock transaction. Custom lines do not change stock.
* **Data:** `id`, `orderId`, `processedById`, `totalRefund`, `reason`, `createdAt`, `items`, and `refundStatus`.

## 9. Reports (`/reports`)

Downloads (`/reports/export`) return the file. They are not wrapped in `{ success, message, data, timestamp }`. Dashboard and transaction responses are.

Revenue for a window is the sum of `totalAmount` on orders created in that window, minus the sum of `totalRefund` on those same orders. Units sold subtract refunded quantities. Day and month boundaries are UTC. Rolling 30 days is the last 30 days from the request time. Nothing is totaled across businesses.

### Dashboard

* **GET** `/reports/dashboard`
* **Who:** `CASHIER` or `ADMIN`
* A cashier receives `{ "myDailyRevenue", "myDailyUnitsSold", "myMonthlyRevenue" }` for their own orders.
* An admin receives `{ "globalDailyRevenue", "globalRolling30DayRevenue", "staffLeaderboard" }`.
* `staffLeaderboard` is cashiers of this business, excluding soft-deleted users, sorted by this month's revenue after refunds. Each entry has `cashierId`, `fullName`, `publicId`, and `revenue`.

### Transaction log

* **GET** `/reports/transactions?page=1&limit=20`
* **Who:** `ADMIN`
* `page` defaults to 1. `limit` defaults to 20 and cannot exceed 100.
* **Data:** `{ "items", "page", "limit", "total" }`
* Each order includes `receiptNumber`, `customerNumber`, `totalAmount`, `paymentMethod`, `createdAt`, `cashier` (`id`, `fullName`, `publicId`), and `items` (`variantId`, `customItemName`, `price`, `quantity`, `subtotal`).

### Export

* **GET** `/reports/export?type=payroll&format=pdf&month=10&year=2026`
* **Who:** `ADMIN`
* `type`: `payroll` or `sales`. `format`: `csv` or `pdf`. `month` is 1–12. `year` is 2000–2100.
* CSV uses `Content-Type: text/csv` and `Content-Disposition: attachment`.
* PDF uses `Content-Type: application/pdf` and the same attachment disposition. The page is A4, with a navy `#070B28` header and electric blue `#0052FF` accents. The SunTech logo is embedded from `assets/image_0057bd.png` when the file is on disk.
* Payroll columns: Cashier Name, Base Salary, Advances Deducted, Net Paid. Figures come from `PayrollRecord` for that month.
* Sales columns: Receipt, Date, Cashier, Customer, Total, Refunded, Net. Orders are those created in the UTC month.
* A month with zero payroll rows still returns a PDF. The table contains `Empty Report` and zeros.
* A cashier receives 403 `"You do not have permission to perform this action"`.
