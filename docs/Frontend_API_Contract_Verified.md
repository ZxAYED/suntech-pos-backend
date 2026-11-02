# Suntech POS — Verified Frontend API Contract

This document provides the authoritative, code-verified API contract for the Suntech POS backend (`d:\Project\SuntechPOS-backend`). It is grounded directly in the actual NestJS controllers, DTOs, interceptors, and response presenters.

---

## 1. Global Envelope Structures

### 1.1 Success Envelope (`TransformInterceptor`)
All successful HTTP responses are wrapped in a standard JSON envelope.
**Important:** The response body does **not** contain a `statusCode` field. The HTTP status code is communicated exclusively via standard HTTP response status headers (e.g., `200 OK`, `201 Created`).

```typescript
export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  timestamp: string; // ISO 8601 string
}
```

**Example (`201 Created` on Shift Open):**
```json
{
  "success": true,
  "message": "Shift opened successfully",
  "data": {
    "id": "shift-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "startingAmount": 5000,
    "status": "OPEN",
    "openedAt": "2026-11-01T18:30:00.000Z",
    "cashierId": "usr-123",
    "businessId": "biz-456",
    "locationId": "loc-789"
  },
  "timestamp": "2026-11-01T18:30:00.123Z"
}
```

### 1.2 Error Envelope (`GlobalExceptionFilter`)
All application errors and uncaught exceptions return a standardized error envelope:

```typescript
export interface ApiErrorResponse {
  success: false;
  message: string; // Error summary or comma-separated validation errors
  timestamp: string; // ISO 8601 string
  code?: string; // e.g. "PRICE_CHANGED"
  [key: string]: any; // Structured context if available
}
```

**Example (`409 Conflict` on Catalog Price Mismatch):**
```json
{
  "success": false,
  "message": "Product price changed. Please refresh your cart.",
  "code": "PRICE_CHANGED",
  "variantId": "var-123",
  "currentPrice": 450,
  "submittedPrice": 400,
  "timestamp": "2026-11-02T11:30:00.000Z"
}
```

---

## 2. Authentication & Roles

### 2.1 Actual Roles (`Role` Enum)
The database schema (`prisma/schema/user.prisma`) defines exactly three roles:
- `SUPER_ADMIN`
- `ADMIN`
- `CASHIER`

> [!NOTE]
> There are **no** `MANAGER` or `STAFF` roles in the backend.

### 2.2 Scoping Rules: Admin vs. Cashier
- **Cashier Scoping:**
  - Cashier JWTs contain `sub`, `role: "CASHIER"`, `businessId`, and `locationId`.
  - Cashier requests automatically use their assigned `businessId` and `locationId` from the token. Cashiers cannot override business or location context (attempts to specify mismatched parameters return `403 Forbidden`).
- **Admin Scoping:**
  - Admin requests must explicitly supply `businessId` (and `locationId` where branch-scoped) via DTOs/queries when interacting with branch-scoped or tenant-scoped resources (e.g., opening shifts, checkout, dashboard metrics, expenses, staff management, payroll).
  - Missing required `businessId` returns **`400 Bad Request`**.
  - Mismatched combinations (e.g., `locationId` belonging to `biz-2` while `businessId` is `biz-1`) are rejected with **`400 Bad Request: Location does not belong to the specified business`** without silent fallback or scope switching.

---

## 3. Mandatory Idempotency Headers

Endpoints decorated with `@Idempotent()` enforce the `Idempotency-Key` header (`request.header('idempotency-key')`).
- If omitted or empty: returns **`400 Bad Request: Idempotency-Key header is required`**.
- Maximum length: 200 characters.
- Replaying a request with the same key within 24 hours returns the cached HTTP status and response payload.

### Real Endpoints Requiring `Idempotency-Key`:
| Method | Path | Controller Method | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/shifts/open` | `ShiftController.open` | Open register shift session |
| `POST` | `/api/v1/shifts/close` | `ShiftController.closeCurrent` | Close active shift session |
| `POST` | `/api/v1/shifts/:id/close` | `ShiftController.close` | Close specific shift session |
| `POST` | `/api/v1/orders/catalog` | `OrderController.createCatalogOrder` | Checkout catalog order |
| `POST` | `/api/v1/orders/custom` | `OrderController.createCustomOrder` | Checkout custom amount/item order |
| `POST` | `/api/v1/orders` | `OrderController.createOrder` | Checkout standard order |
| `POST` | `/api/v1/orders/:id/refunds` | `RefundController.create` | Process order item refund |
| `POST` | `/api/v1/expenses` | `ExpenseController.create` | Record operating expense |
| `POST` | `/api/v1/advances` | `AdvanceController.create` | Record employee salary advance (Cashier) |
| `POST` | `/api/v1/payroll/process` | `PayrollController.process` | Settle single employee payroll |
| `POST` | `/api/v1/payroll/disburse` | `PayrollController.disburse` | Batch disburse monthly payroll |
| `PATCH` | `/api/v1/catalog/variants/stock` | `VariantController.updateStockBatch` | Adjust variant stock (body variantId) |
| `PATCH` | `/api/v1/catalog/variants/:id/stock` | `VariantController.updateStock` | Adjust variant stock (path variantId) |
| `POST` | `/api/v1/catalog/variants/:id/stock` | `VariantController.updateStockPost` | Adjust variant stock (POST alias) |

---

## 4. Shift Management Contract

### 4.1 Opening a Shift (`POST /api/v1/shifts/open`)
- **Required Header:** `Idempotency-Key: <unique-uuid-or-key>`
- **Payload (`OpenShiftDto`):**
  - `startingAmount`: **`number`** (integer $\ge 0$, whole BDT). **Do not use `openingCash`.**
  - `autoClosePrevious` *(optional)*: `boolean` (default `false`). Required if a shift from a previous calendar day was left open.
  - `businessId` *(optional for Cashier, required for Admin)*: `string`
  - `locationId` *(optional for Cashier, required for Admin)*: `string`

```json
{
  "startingAmount": 5000,
  "autoClosePrevious": false
}
```

### 4.2 Closing a Shift (`POST /api/v1/shifts/close` or `POST /api/v1/shifts/:id/close`)
- **Required Header:** `Idempotency-Key: <unique-uuid-or-key>`
- **Payload (`CloseShiftDto`):**
  - `closingAmount`: `number` (actual cash counted in the drawer by cashier, whole BDT)
  - `notes` *(optional)*: `string`
  - `businessId` *(optional for Cashier, accepted for Admin)*: `string`

```json
{
  "closingAmount": 28470,
  "notes": "Evening shift balanced"
}
```

---

## 5. Orders & Refunds Contract

### 5.1 Catalog Checkout (`POST /api/v1/orders/catalog`)
- **Required Header:** `Idempotency-Key: <unique-uuid-or-key>`
- **Payload (`CreateCatalogOrderDto`):**
  - `items`: Array of `{ variantId: string, quantity: number, unitPrice: number, name?: string }`
  - `paymentMethod`: Explicit enum string (`"CASH" | "CARD" | "BKASH" | "NAGAD" | "BANK_TRANSFER" | "COD"`).
    - Note: Omitting payment method returns `400 Bad Request`.
    - If `paymentType` is passed as alias, it must match `paymentMethod`.
  - `businessId` *(required for Admin)*: `string`
  - `locationId` *(required for Admin)*: `string`
  - `customerPhone`, `customerName`, `customerEmail` *(optional)*: `string`
- **Price Check Validation:**
  - If any line's `unitPrice` differs from current database `variant.sellingPrice`, returns HTTP `409 Conflict` with code `"PRICE_CHANGED"`, `currentPrice`, and `submittedPrice`.

### 5.2 Custom Checkout (`POST /api/v1/orders/custom`)
- **Required Header:** `Idempotency-Key: <unique-uuid-or-key>`
- **Payload (`CreateCustomOrderDto`):**
  - `items`: Array of `{ title: string, amount: number, quantity: number }`
  - `paymentMethod`: Explicit enum string (required, returns `400` if omitted).

### 5.3 Order Presentation (`GET /api/v1/orders` and `GET /api/v1/orders/:id`)
- Order objects return:
  - `refundStatus`: `null | "PARTIALLY_REFUNDED" | "REFUNDED"`
  - `lines`: array with `refundedQuantity: number` and `refundableQuantity: number`.

### 5.4 Refunds (`POST /api/v1/orders/:id/refunds`)
- **Required Header:** `Idempotency-Key: <unique-uuid-or-key>`
- **Payload (`CreateRefundDto`):**
  - `items`: Array of `{ orderItemId: string, quantity: number }`
  - `reason`: `string`
  - `payoutMethod`: `"CASH" | "CARD" | "BKASH" | "NAGAD" | "BANK_TRANSFER" | "COD"`
  - `payoutShiftId` *(optional)*: `string | null`.
    - Cashiers may omit this; if provided, it MUST belong to the authenticated cashier's open shift.
    - Cashier refunds without an open shift succeed with `payoutShiftId: null`.

---

## 6. HR & Payroll Contract

### 6.1 Employee Advances (`/api/v1/advances`)
- **Create Advance (`POST /api/v1/advances`)**:
  - Cashier self-service only (`Role.CASHIER`).
  - Payload: `{ amount: number, reason?: string }`
  - No manager approval or active shift required.
- **List Advances (`GET /api/v1/advances`)**:
  - Response includes `deductedAmount: number` and `remainingAmount: number`.
- **Delete Advance (`DELETE /api/v1/advances/:id`)**:
  - Deleting an advance that has been partially or fully deducted returns HTTP `409 Conflict`.

### 6.2 Payroll Processing (`/api/v1/payroll`)
- **Summary (`GET /api/v1/payroll/summary`)**:
  - Query params: `month` (1-12), `year`, `locationId?`, `businessId?`.
  - Shows estimated base salaries and net payables with applied advances.
- **Single Cashier Settlement (`POST /api/v1/payroll/process`)**:
  - Required Header: `Idempotency-Key: <unique-uuid-or-key>`
  - Payload (`ProcessPayrollDto`): `{ cashierId: string, month: number, year: number, businessId?: string }`
  - Rejects with `400 Bad Request` if cashier has zero or null base salary.
  - Automatically deducts eligible advances FIFO (`netPaid = Math.max(0, baseSalary - advances)`).
  - Creates single `PAYROLL_NET` Expense under `SALARIES` only when `netPaid > 0`.
- **Batch Disbursement (`POST /api/v1/payroll/disburse`)**:
  - Required Header: `Idempotency-Key: <unique-uuid-or-key>`
  - Payload (`DisbursePayrollDto`): `{ month: number, year: number, locationId?: string, businessId?: string }`
  - Iterates over active cashiers with positive salary who have not yet been paid for the period.

---

## 7. Catalog & Variant Management

### 7.1 Two-Step Product & Variant Creation
- **Step 1: Create Product (`POST /api/v1/catalog/products`)**
  - Payload: `{ name: string, description?: string, categoryId?: string, businessId?: string, customAttributes?: any }`
- **Step 2: Create First Variant (`POST /api/v1/catalog/variants`)**
  - Payload: `{ productId: string, name: string, sellingPrice: number, costPrice?: number, sku?: string, barcode?: string, stock?: number, locationId?: string, businessId?: string }`

### 7.2 Variant Updates (`PATCH /api/v1/catalog/variants/:id`)
- Updates price, cost price, SKU, barcode, stock, or name in a single call.
- Stock adjustments can also be made via `PATCH /api/v1/catalog/variants/:id/stock` with `UpdateVariantStockDto` (`operation: "add" | "deduct" | "set"`, `quantity: number`).

---

## 8. Branch Management & Deletion Guard

### 8.1 Delete Branch Location (`DELETE /api/v1/tenants/locations/:id`)
- Soft-deletes a branch location.
- Guard: If there are active assigned cashiers (`deletedAt: null`), the request is rejected with HTTP `409 Conflict: Cannot delete branch with active assigned staff. Reassign or delete staff first.`

---

## 9. Financial Integrity & Metric Definitions

### 9.1 Physical Cash in Drawer (Register Shift)
Reflects physical currency notes and coins physically present in the cash drawer at a specific station.

$$\text{expectedCash} = \text{startingAmount} + \text{cashSales} - \text{advancesOut}$$

- **`startingAmount`**: Opening cash float placed into the drawer at shift open.
- **`cashSales`**: Net cash receipts $= \text{COD sales totalAmount} - \text{COD refunds totalRefund paid out from this shift}$.
- **`advancesOut`**: Total cash salary advances handed out to staff directly from this drawer during the shift.
- **`variance`** (at shift close): $\text{closingAmount} - \text{expectedCash}$. Positive is cash overage, negative is cash shortage.

### 9.2 Operating Estimate (`netCashflowToday` on Admin Dashboard)
Reflects high-level business operational performance across all sales channels and payment methods.

$$\text{netCashflowToday} = \text{todayNetSales} - \text{todayExpenseTotal}$$

- **`todayGrossSales`**: Sum of all sales across **all payment methods** (`COD`, `BKASH`, `NAGAD`, `CARD`, `BANK_TRANSFER`, etc.).
- **`todayRefundedAmount`**: Sum of all refunds processed today across **all payment methods**.
- **`todayNetSales`**: $\text{todayGrossSales} - \text{todayRefundedAmount}$.
- **`todayExpenseTotal`**: Sum of all operating expenses recorded today (`MANUAL` store expenses + `PAYROLL_NET` settled salary payouts).

> [!WARNING]
> Do **not** display `netCashflowToday` as "Cash in Hand" or "Register Cash". It represents an operational net estimate across all cash and digital channels, whereas `expectedCashInDrawer` represents physical currency in the cashier drawer.
