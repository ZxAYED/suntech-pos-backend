SunTech POS — Backend Architecture
NestJS 11 · Prisma 6 · PostgreSQL · TypeScript
Architecture: Modular monolith · Controller/Service layers · REST API · Shared-schema multi-tenancy
Target: Online-first POS for Admin, Cashier and Super Admin roles; approximately 100 lifetime users expected
Source reviewed: backend(20261102-073321).zip + frontend(20261102-124820).zip, November 2, 2026

This is an architectural and interview-study README grounded in the provided source. For route-by-route DTO detail, use the actual controllers/DTOs and generated Swagger (/api/docs) and keep [`docs/POS.md`](docs/POS.md) updated. Some existing historical docs/ files contain superseded business rules. Describing a feature here does not mean its complete build, migrations or live end-to-end tests have been independently certified.
Approved MVP rules: Negative branch stock allowed · No shift required for checkout or cashier advance · Advances remain in their own ledger and are deducted from eligible monthly payroll · Payroll creates only the actual net payout PAYROLL_NET Expense · Admin selects owned business/branch dynamically · Cashier is assigned one business/branch · Offline/PWA deferred.

Contents

1. Architecture map
2. What is a modular monolith?
3. Request lifecycle and NestJS layers
4. Authentication, BFF and signed session
5. Multi-tenant data design
6. Who owns advances and payroll?
7. Checkout, stock and transactional integrity
8. Refunds, shifts and cash calculations
9. Payroll calculation with FIFO advance carryover
10. Expenses and financial reporting
11. Idempotency, concurrency and historical integrity
12. Actual REST endpoint map
13. Database schema and migrations
14. Environment, startup and local development
15. Deployment, testing and constraints
16. Architecture interviews and scaling decisions
17. Architecture map

```mermaid
flowchart TB
  subgraph CLIENT["Next.js browser application"]
    ADM["Admin"]
    CASH["Cashier"]
    SUPER["Super Admin"]
    BFF["Next.js BFF<br/>/api/v1/*"]
    ADM --> BFF
    CASH --> BFF
    SUPER --> BFF
  end

  subgraph SERVER["NestJS modular monolith"]
    HTTP["REST controller / DTO / ValidationPipe"]
    SECURITY["JWT · Roles · Business/branch authorization"]
    SERVICE["Domain services<br/>Catalog · Orders · Refunds · HR · Reports"]
    TX["Prisma transactions and queries"]
    HTTP --> SECURITY --> SERVICE --> TX
  end

  DB[("PostgreSQL")]
  CLOUD["Cloudinary"]
  MAIL["SMTP email"]

  BFF -->|"HTTP /api/v1 + HttpOnly cookies"| HTTP
  TX --> DB
  SERVICE --> CLOUD
  SERVICE --> MAIL

  classDef web fill:#eaf2ff,stroke:#477ee3,color:#1d3f79;
  classDef backend fill:#e7f7ed,stroke:#48a869,color:#255d35;
  classDef external fill:#f4edff,stroke:#9572c1,color:#553782;
  class ADM,CASH,SUPER,BFF web;
  class HTTP,SECURITY,SERVICE,TX backend;
  class DB,CLOUD,MAIL external;
```

Technology and responsibility boundaries
Layer Actual implementation Responsibility
Browser UI Next.js 16 / React 19 Forms, register UI, selection, client cache
BFF Next.js src/app/api/v1/[...path]/route.ts Same-origin transport, secure browser cookie handling, session projection
REST application NestJS 11 Business APIs, guards, DTOs, errors, audit and permissions
Data access Prisma 6 Typed queries, transactions and schema migrations
Transactional storage PostgreSQL Unique constraints, relations, locks, persistent data
Media Cloudinary Product/staff/business images
Email SMTP via mail service OTP and account-related mail
API documentation Swagger at /api/docs Generated route/DTO reference

2. What is a modular monolith?
   A modular monolith runs as one deployable backend process, but its source is split into business modules. This is not a microservices architecture.

```mermaid
flowchart TB
  APP["AppModule"] --> AUTH["AuthModule"]
  APP --> TENANT["TenantModule"]
  APP --> USERS["UserModule"]
  APP --> CAT["CatalogModule"]
  APP --> ORDERS["OrdersModule"]
  APP --> SHIFTS["ShiftModule"]
  APP --> HR["HrModule"]
  APP --> EX["ExpenseModule"]
  APP --> REPORT["ReportsModule"]
  APP --> AUDIT["AuditModule"]
  APP --> MEDIA["MediaModule"]
  APP --> ADMIN["AdminModule"]
  APP --> OFF["OfflineModule · not MVP"]
  APP --> PRISMA["PrismaModule · shared DB client"]

  classDef root fill:#122b57,stroke:#315ed4,color:#ffffff;
  classDef module fill:#eaf3ff,stroke:#739de3,color:#183b6e;
  class APP root;
  class AUTH,TENANT,USERS,CAT,ORDERS,SHIFTS,HR,EX,REPORT,AUDIT,MEDIA,ADMIN,OFF,PRISMA module;
```

Why this architecture was chosen: simple deployment; strong transaction integrity in one PostgreSQL database; clear separation of domains; reasonable maintainability without queues, distributed transactions, microservices or multiple databases. At the expected size, modularity matters more than distributed scaling.

Source: [`src/app.module.ts`](src/app.module.ts). Global request throttling, idempotency interception, response transformation, salary masking and exception filtering are also registered here. 3. Request lifecycle and NestJS layers

```mermaid
flowchart LR
  REQ["HTTP request"] --> THR["Global throttling"]
  THR --> GUARD["JWT + Roles Guards"]
  GUARD --> VAL["DTO validation / transformation"]
  VAL --> CTRL["Controller"]
  CTRL --> SERV["Service / domain rules"]
  SERV --> ORM["Prisma"]
  ORM --> DB[("PostgreSQL")]
  DB --> RESP["Response / exception interceptors"]
  RESP --> RES["JSON or file response"]
```

The chart illustrates responsibility boundaries, not every exact NestJS lifecycle hook order. In NestJS, globally registered interceptors, guards and pipes have their own execution order.
Layers in the actual repository
Layer Examples Responsibilities
Controller orders/order.controller.ts, hr/payroll.controller.ts HTTP method/path, roles, DTO bindings
DTO orders/dto/create-catalog-order.dto.ts Check fields, enums and integer constraints
Guard auth/guards/jwt-auth.guard.ts, roles.guard.ts Authentication and role restriction
Service orders/order.service.ts, hr/payroll.service.ts Ownership, calculations, transactions, workflows
Prisma service prisma/prisma.service.ts Shared Prisma client and DB lifecycle
Interceptors common/interceptors/* Idempotency, response envelope, salary masking
Exception filter common/filters/global-exception.filter.ts Consistent HTTP errors

Global JSON success envelope:
{
"success": true,
"message": "Catalog order created",
"data": { "id": "<order-uuid>" },
"timestamp": "2026-11-02T12:00:00.000Z"
}
This is a shape illustration, not a verbatim full checkout response. File downloads are handled differently from JSON. Input validation uses class-validator/`class-transformer` and ValidationPipe({ whitelist: true, transform: true, enableImplicitConversion: true }); do not assume this makes every optional or malformed number input strict without tests. 4. Authentication, BFF and signed session
Real authentication lives in NestJS
[`auth/strategies/jwt.strategy.ts`](src/auth/strategies/jwt.strategy.ts) extracts the JWT from a Bearer header or auth cookie, verifies it using JWT_ACCESS_SECRET, and then queries PostgreSQL for the current user, role, account status and tenant membership. Suspended/deleted users or unassigned Cashiers are rejected.

```mermaid
sequenceDiagram
  autonumber
  actor U as Staff user
  participant UI as Next.js browser
  participant BF as Next BFF
  participant AU as NestJS AuthController
  participant DB as PostgreSQL
  U->>UI: Log in
  UI->>BF: POST /api/v1/auth/login
  BF->>AU: Forward credentials
  AU->>DB: Verify user credentials & status
  DB-->>AU: Valid user
  AU-->>BF: Access token + HttpOnly auth cookies
  BF->>BF: HMAC-sign user projection
  BF-->>UI: HttpOnly auth + suntech_session; no access token in JSON
  UI->>BF: Subsequent protected API call
  BF->>AU: Forward cookie to NestJS
  AU->>DB: Validate JWT and current role/business/branch
  DB-->>AU: Authorized
  AU-->>UI: Authorized result via BFF
```

Why a second suntech_session cookie?
The frontend [`src/lib/session-cookie.ts`](../frontend/src/lib/session-cookie.ts) signs a user/role/`issuedAt` projection using HMAC-SHA-256. [`src/proxy.ts`](../frontend/src/proxy.ts) can then quickly decide route redirects without querying NestJS on every page navigation.

HMAC is integrity protection, not encryption. The cookie does not authorize payroll, expenses or stock mutations. Only the backend JWT strategy plus service ownership rules authorize APIs. The Next session can become stale between refreshes; the backend checks the current database user on protected API calls.
Credential or state Purpose Security authority
NestJS access JWT API authentication Backend signature + current DB user check
Refresh token cookie Obtain renewed access token NestJS refresh validation
suntech_session Fast frontend route/user projection Next.js navigation only
Admin businessId/`locationId` UI selection Which owned resource to operate on Checked by backend; local selection is untrusted

Backend Auth API: /api/v1/auth/register, /login, /refresh, /logout, /forgot-password, /verify-otp, /reset-password.

BFF alternatives: A browser could call NestJS directly with carefully configured cookies/CORS, or an Nginx reverse proxy could offer same-origin /api/v1; Next server actions can coexist with the BFF. See the [frontend README](../frontend/README.md#2-why-bff-what-are-the-alternatives) for pros/cons. The chosen BFF is reasonable but not mandatory. 5. Multi-tenant data design
SunTech is a shared-database, shared-schema multi-tenant application. Every business uses the same PostgreSQL database, but records carry ownership/scope references and backend access rules.
Organization chart

```mermaid
flowchart TB
  PLATFORM["Super Admin · platform"]
  OWNER["Admin user · can own multiple businesses"]
  PLATFORM -.-> OWNER
  OWNER --> B1["Business A"]
  OWNER --> B2["Business B"]
  B1 --> A1["Branch A1"]
  B1 --> A2["Branch A2"]
  B2 --> B21["Branch B1"]
  A1 --> E1["Cashier 1"]
  A2 --> E2["Cashier 2"]
  B21 --> E3["Cashier 3"]
  E1 --> ADV1["Advances · payroll · shifts"]
  E2 --> ADV2["Advances · payroll · shifts"]
  E3 --> ADV3["Advances · payroll · shifts"]

  classDef owner fill:#172a4f,stroke:#315fd6,color:#fff;
  classDef business fill:#eaf3ff,stroke:#5490d4,color:#153b68;
  classDef branch fill:#eef8f1,stroke:#56a477,color:#225d35;
  classDef staff fill:#fff5e8,stroke:#d9a657,color:#6f4c1e;
  class PLATFORM,OWNER owner;
  class B1,B2 business;
  class A1,A2,B21 branch;
  class E1,E2,E3,ADV1,ADV2,ADV3 staff;
```

The diagram models the intended relationship: each Cashier is assigned to one business and branch at a time; an Admin can own multiple businesses.
Relational ER diagram — tenant/catalog/orders

```mermaid
 erDiagram
    User ||--o{ Business : "owns (Admin)"
    Business ||--o{ Location : "has branches"
    Business ||--o{ User : "assigns staff"
    Location ||--o{ User : "assigns Cashiers"
    Business ||--o{ Category : "owns"
    Business ||--o{ Product : "owns"
    Category o|--o{ Product : "groups"
    Product ||--o{ Variant : "has"
    Variant ||--o{ LocationStock : "branch stock"
    Location ||--o{ LocationStock : "stores"
    Location ||--o{ Order : "takes sales"
    User ||--o{ Order : "cashier"
    Order ||--|{ OrderLine : "contains"
    Variant o|--o{ OrderLine : "snapshot"
    Order ||--o{ Refund : "has"
    Refund ||--o{ RefundItem : "contains"
    OrderLine ||--o{ RefundItem : "refunded line"
```

Important actual schema nuance: Order has locationId and cashierId but no direct businessId. Its tenant is derived through Order.location.businessId and authorized queries. EmployeeAdvance, PayrollRecord, Expense and LocationStock do have explicit businessId fields.
Tenant enforcement flow

```mermaid
flowchart TD
  REQ["Request"] --> WHO{"Authenticated role?"}
  WHO -->|ADMIN| SEL["Frontend supplies selected business/branch"]
  SEL --> OWN["Verify Admin owns business"]
  OWN --> MATCH["Verify location belongs to business"]
  WHO -->|CASHIER| STAFF["Use current assigned business/branch"]
  STAFF --> SCOPE["Reject tenant override"]
  WHO -->|SUPER_ADMIN| PLATFORM["Apply platform-specific scope"]
  MATCH --> QUERY["Scoped Prisma query"]
  SCOPE --> QUERY
  PLATFORM --> QUERY
  QUERY --> DB[("Business-isolated result")]
```

Source: [`jwt.strategy.ts`](src/auth/strategies/jwt.strategy.ts), [`require-business-id.ts`](src/hr/require-business-id.ts), [`tenant-scope.util.ts`](src/common/utils/tenant-scope.util.ts), service-specific ownership validation.

Caveat: requireBusinessId() still uses requestedBusinessId?.trim() || actor.businessId for some Admin paths. The frontend sends explicit IDs by product design, but do not claim all backend endpoints reject a missing Admin ID; verify each route. This is a legacy fallback, not a hardcoded first-business dependency in the frontend. 6. Who owns advances and payroll?
Answer: They are employee-specific records in a business, not just user-only data or business-only data. The same business can have many Cashiers and each Cashier has their own salary-advance history and payroll records.
Employee-finance ER diagram

```mermaid
 erDiagram
    Business ||--o{ User : "employs"
    Location ||--o{ User : "assigns"
    Business ||--o{ EmployeeAdvance : "owns ledger"
    User ||--o{ EmployeeAdvance : "takes"
    Location o|--o{ EmployeeAdvance : "historical branch"
    ShiftSession o|--o{ EmployeeAdvance : "optional link"
    Business ||--o{ PayrollRecord : "owns payroll"
    User ||--o{ PayrollRecord : "receives"
    EmployeeAdvance ||--o{ PayrollAdvanceDeduction : "allocated from"
    PayrollRecord ||--o{ PayrollAdvanceDeduction : "deducts"
    PayrollRecord ||--o| Expense : "net paid expense"
    Business ||--o{ Expense : "owns"
    User o|--o{ Expense : "beneficiary"
```

Prisma table Employee-specific column Tenant/branch columns Key behavior
User id businessId?, locationId? A Cashier is assigned one business/branch at a time
EmployeeAdvance cashierId businessId, optional locationId Keeps historical branch snapshot and amount/deduction status
PayrollRecord cashierId businessId; no direct locationId One row per cashier/month/year
PayrollAdvanceDeduction Via advance/payroll FKs Via linked records Allocation of advance amount to specific payroll
Expense beneficiaryCashierId? businessId, locationId? PAYROLL_NET generated from actual payout
ShiftSession cashierId businessId, locationId Physical cash session, not a sales prerequisite

What does “business-unique” mean here?
Three different concepts must not be confused:

1. User identity is global: User.id is a database-wide UUID; User.email is globally unique. The Cashier currently has a single User.businessId and User.locationId at one time.
2. Ledger access is business-scoped: advances/payroll carry businessId in addition to cashierId; service queries filter by the authorized business and employee.
3. Payroll uniqueness is not (businessId, cashierId, month, year): the actual Prisma constraint is:
   @@unique([cashierId, month, year])
   Therefore a single cashierId cannot have two payroll records for the same month/year even if the employee were later transferred between businesses. This is consistent with the current single-employer-at-a-time Cashier model, but not a general multi-employer payroll system. If multi-business employment/transfers become a future requirement, define the policy before changing the unique key, historical attribution and authorization.
   Business A
   └── Cashier 7 (User.id = U7; User.businessId = A)
   ├── Advance #1 → businessId=A, cashierId=U7, locationId=A1
   ├── Advance #2 → businessId=A, cashierId=U7, locationId=A1
   └── Payroll Oct → businessId=A, cashierId=U7, month=10, year=2026
   ├── PayrollAdvanceDeduction #1
   ├── PayrollAdvanceDeduction #2
   └── PAYROLL_NET Expense (only actual net payout)
   Who can act? A Cashier can create and view their own advances; Admins can view an authorized business's advances and process payroll. Cashiers cannot edit Admin Expenses or disburse payroll. Advance creation validates the Cashier belongs to the business. Relevant code: [`advance.service.ts`](src/hr/advance.service.ts), [`payroll.service.ts`](src/hr/payroll.service.ts), [`hr.prisma`](prisma/schema/hr.prisma).
4. Checkout, stock and transactional integrity
   Catalog checkout
   Actual endpoint: POST /api/v1/orders/catalog (@Idempotent(), Admin or Cashier). Checkout selects a variant, not merely a product.

```mermaid
flowchart TD
  IN["POST /orders/catalog"] --> AUTH["Verify role and business/location scope"]
  AUTH --> VAL["Validate variant, quantity, submitted price, payment"]
  VAL --> PRICE{"Price still matches DB?"}
  PRICE -->|No| CONFLICT["409 PRICE_CHANGED · no commit"]
  PRICE -->|Yes| TX["Serializable Prisma transaction"]
  TX --> ORD["Create Order + OrderLines snapshots"]
  TX --> STOCK["Update LocationStock"]
  TX --> MOV["Record SALE stock movement"]
  ORD --> COMMIT["Commit or rollback together"]
  STOCK --> COMMIT
  MOV --> COMMIT
  COMMIT --> REC["Invoice/receipt response"]
```

Catalog request example — Admin:
{
"businessId": "<authorized-business-uuid>",
"locationId": "<branch-uuid-in-business>",
"paymentMethod": "COD",
"tenderedAmount": 1500,
"lines": [
{ "variantId": "<variant-uuid>", "quantity": 3, "unitPrice": 400 }
]
}
Idempotency-Key: <stable-uuid> is required. For a Cashier, businessId/`locationId` are derived from account assignment; don't allow a request to change scope.

Whole-BDT calculation:
lineSubtotal = unitPrice * quantity
orderTotal = sum(lineSubtotal across lines)
changeDue = tenderedAmount - orderTotal (for valid tenderedAmount)
For 400 × 3, total = 1200 BDT; 1500 tendered gives 300 BDT change. The helper [`src/orders/money.ts`](src/orders/money.ts) checks multiplication/sums against PostgreSQL's signed 32-bit integer maximum. Backend price is authoritative; the frontend's submitted snapshot triggers a conflict if stale.
Branch stock (negative is intentional)
Variant stock at Branch A = 2
Quantity sold = 3
New Branch A stock = -1 ✅ allowed in online MVP
Branch B stock = unchanged
For stock mutations, the store uses LocationStock with unique (locationId, variantId). The same Variant can have a separate balance at each branch. Custom free-text sales without a variant do not deduct inventory.
Catalog deletion safeguards
The current source includes soft-delete and protection for sold/refunded items and nonzero stock. These controls protect historical records and avoid hiding inventory. The exact entity checks and concurrency cases should still be exercised in PostgreSQL integration tests before relying on them as fully verified production guarantees. 8. Refunds, shifts and cash calculations
Refund data flow

```mermaid
flowchart TD
  REF["POST /orders/:id/refunds"] --> SCOPE["Verify order and refunding actor scope"]
  SCOPE --> QUANTITY["Verify each refundable line quantity"]
  QUANTITY --> TX["Database transaction"]
  TX --> RI["Refund + RefundItems"]
  TX --> STOCK["Return variant units into branch stock"]
  TX --> STATUS["Update partial/full refunded status"]
  TX --> CASH["If cash payout, attribute actual verified drawer shift"]
  RI --> DONE["Consistent refund + stock history"]
  STOCK --> DONE
  STATUS --> DONE
  CASH --> DONE
```

CreateRefundDto accepts businessId?, payoutShiftId?, reason?, and items: [{ orderItemId, quantity }]; it does not define a payoutMethod field. Repeated refunds must never exceed unrefunded quantities. Stock restoration applies to catalog variant items, not unrelated custom lines.
Shift expected cash — current register-oriented calculation
From src/shifts/shift.service.ts, shift-specific calculation is based on:
cashSales = COD sales linked to shift − COD refunds associated with shift
advancesOut = advances linked to that shift
expectedAmount = startingAmount + cashSales − advancesOut
variance = closingAmount − expectedAmount (when physically counted)
Example: startingAmount=5000, COD sales=4000, COD refunds=500, linked advances=1000 → expected = 5000 + (4000 − 500) − 1000 = 7500 BDT. If physically counted closing amount is 7300, variance = −200 BDT.

Sales/advances do not need a shift to succeed. Therefore, shift totals alone are not the same as all cash movements in a branch. Cash/physical-drawer metrics must also be distinguished from bKash/Nagad/bank methods. 9. Payroll calculation with FIFO advance carryover
Actual endpoints: POST /api/v1/payroll/process (single Cashier), POST /api/v1/payroll/disburse (batch), GET /api/v1/payroll/summary, GET /api/v1/payroll/history. Payroll processing is Admin-only and decorated with @Idempotent().

```mermaid
flowchart TD
  P["Admin selects business + payroll month"] --> C["Find eligible Cashier with salary > 0"]
  C --> A["Fetch active outstanding advances before period end"]
  A --> FIFO["Sort takenAt ASC, id ASC · FIFO"]
  FIFO --> APPLY["Apply min(baseSalary, outstanding) across advances"]
  APPLY --> NET["netPaid = baseSalary - applied"]
  NET --> TX["Serializable Prisma transaction"]
  TX --> PAY["Create PayrollRecord"]
  TX --> LINKS["Create PayrollAdvanceDeduction allocations"]
  TX --> ADV["Update deductedAmount and pending/deducted status"]
  NET --> EX{"netPaid > 0?"}
  EX -->|Yes| EXP["One PAYROLL_NET Expense for netPaid"]
  EX -->|No| ZERO["No fictitious zero-amount Expense"]
  EXP --> TX
  ZERO --> TX
  PAY --> DONE["Commit all or roll back"]
  LINKS --> DONE
  ADV --> DONE
```

Formula and examples
eligibleOutstanding = sum(amount - deductedAmount for eligible advances)
appliedToPayroll = min(baseSalary, eligibleOutstanding)
netPaid = max(0, baseSalary - appliedToPayroll)
remainingAdvance = amount - deductedAmount
Scenario Salary Eligible outstanding Applied Net payroll Carried forward
Normal 20,000 2,000 + 3,000 5,000 15,000 0
Excess advance 20,000 25,000 20,000 0 5,000
No eligible advance 20,000 0 0 20,000 0

In the normal case, create one PAYROLL_NET Expense for 15,000; the original 5,000 advances remain in EmployeeAdvance, not Expenses. Partial deductions persist through PayrollAdvanceDeduction and EmployeeAdvance.deductedAmount. The next payroll can consume unpaid carryover.

Concurrency/uniqueness: Both individual and batch payroll use the settlement helper. The service uses Serializable Prisma transactions and retries specific conflicts; the schema's unique (cashierId, month, year) guards against duplicate period records. Historical already-paid payrolls should not be recalculated from the employee's current salary after edits.

Accounting nuance: Payroll deduction is not a second cash withdrawal. The advance was cash out when taken; payroll pays only the resulting net. Voided or already-deducted advances must not be consumed again.

Period: [`payroll-period.ts`](src/hr/payroll-period.ts) uses the Dhaka timezone month boundaries. Payroll is business-scoped and employee-specific (Section 6). 10. Expenses and financial reporting
Admin Expenses is a separate domain (/api/v1/expenses). The public list/summary include only:

- MANUAL — expense explicitly recorded by Admin.
- PAYROLL_NET — system-generated actual net payroll payout.
  SALARY_ADVANCE remains an enum/legacy schema possibility but is not written as a new expense from an advance and is excluded from current public Expenses queries. Payroll-generated Expenses cannot be manually edited as ordinary expenses.

```mermaid
flowchart LR
  M["Admin manual expense"] --> LEDGER["GET /expenses"]
  P["Payroll actual net payout"] --> LEDGER
  A["Cashier advance"] --> ADV["EmployeeAdvance ledger"]
  ADV --> CALC["Monthly payroll deduction"]
  CALC --> P
  ADV -.->|"Never add as a new salary advance Expense"| LEDGER
```

Revenue, cash and reporting are not interchangeable
Metric What to check Why it matters
Gross sales Sum of eligible order totals Includes all payment types when not filtered
Refunds Real refunded amounts (and relevant event date) A refund may happen after the order date
Net sales/revenue Gross minus defined refund total Distinct from actual cash in a drawer
Expenses Manual + payroll net, based on query filters Advances are in a different ledger
Expected shift cash Starting float + linked COD cash net of refunds − linked advances Excludes unrelated branches, many unshifted events
Physical cashflow Cash-source movements only Digital BKASH/NAGAD/BANK must not be treated as physical cash

Source-backed caveat: src/admin/admin-dashboard.service.ts currently sets netCashflowToday = todayNetSales - todayExpenseTotal. This aggregates revenue/expenses rather than proving physical drawer cashflow. Explain the metric honestly; it may include digital sales. The source-level distinction is important in interviews and in UI labeling. A live finance reconciliation test is still needed for production assertions. 11. Idempotency, concurrency and historical integrity
One user action may generate multiple HTTP attempts

```mermaid
sequenceDiagram
  autonumber
  actor Cashier
  participant UI as Frontend
  participant INT as IdempotencyInterceptor
  participant DB as PostgreSQL
  Cashier->>UI: Submit sale with key K
  UI->>INT: POST sale, Idempotency-Key: K
  INT->>DB: Claim unique (scopeId, K)
  INT->>DB: Execute financial transaction
  DB-->>INT: Commit complete
  INT-->>UI: Response (network may drop)
  Cashier->>UI: Retry same key + body
  UI->>INT: POST same operation, key K
  INT->>DB: Check stored request hash/result
  DB-->>INT: Prior result or pending conflict
  INT-->>UI: Replay or reject divergent request
```

Backend source: [`IdempotencyInterceptor`](src/common/interceptors/idempotency.interceptor.ts), [`IdempotencyRecord`](prisma/schema/tenant.prisma). Current default TTL is 24 hours. The database has @@unique([scopeId, key]). The payload hash includes method/path/query/body and actor scope. A reused key with a different request is rejected rather than silently changing the financial operation.

Important limitation: The business transaction and idempotency result are not necessarily one single atomic database commit. Test crash/lost-response windows; do not claim strict exactly-once semantics across every server failure merely because an interceptor exists.
Financial and catalog invariants worth testing
Edge case Intended invariant
Checkout twice with the same key No second legitimate sale
Same key, changed cart Conflict, not a different sale
Two Cashiers sell same variant Stock changes consistently; negative value allowed
Sale while variant deletion attempted Preserve history and avoid orphaned inventory
Refund more units than purchased Reject; never over-refund
Refund on following day Date-based accounting should follow each metric's defined semantics
Cashier advance without shift Allowed; separate Advance ledger, business attribution retained
Advance larger than salary Carry remaining deduction into future eligible payroll
Payroll repeated for same month No double payout/Expense/deduction
Admin requests branch from other business Reject mismatch or ownership violation
Cashier tries another branch Backend enforces assigned branch
Date around midnight Asia/Dhaka Period queries use correct local bounds where required

12. Actual REST endpoint map
    The actual backend prefix is /api/v1 (except root health endpoint); Swagger UI is at /api/docs. These routes come from the current controllers. The table is a navigation index, not a substitute for DTOs and runtime authorization verification.
    Domain HTTP routes Main actor
    Auth POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/forgot-password, /auth/verify-otp, /auth/reset-password Public authentication flows
    Tenant GET /tenant/businesses, GET/POST /tenant/business, PATCH/DELETE /tenant/businesses/:id, GET/POST /tenant/locations, PATCH/DELETE /tenant/locations/:id, business profile image routes Admin; some reads also Cashier
    Staff GET /users/me, POST /users/cashiers, GET /users/cashiers, PATCH/DELETE /users/cashiers/:id, staff status/profile image routes Admin writes; profile self-service as permitted
    Categories POST/GET /catalog/categories, GET/PATCH/DELETE /catalog/categories/:id Admin writes, Admin/Cashier reads
    Products POST/GET /catalog/products, GET /catalog/products/summary, /metrics, /stats, GET/PATCH/DELETE /catalog/products/:id Admin writes, wider scoped reads
    Variants POST/GET /catalog/variants, GET/PATCH/DELETE /catalog/variants/:id, PATCH /catalog/variants/stock, PATCH/POST /catalog/variants/:id/stock Admin stock writes
    Images /variants/:variantId/profile-image, /variants/:variantId/images As controller role/ownership permits
    Checkout POST /orders/catalog, POST /orders/custom, legacy POST /orders Admin / Cashier
    Orders GET /orders, GET /orders/:id Authenticated, scoped
    Refund POST /orders/:id/refunds Admin / Cashier with checks
    Advances POST /advances, GET /advances, GET /advances/summary, DELETE /advances/:id Cashier create; Admin/Cashier reads; Admin delete
    Payroll GET /payroll, /payroll/history, /payroll/summary, POST /payroll/process, /payroll/disburse Admin
    Expenses POST/GET /expenses, GET /expenses/summary, PATCH/DELETE /expenses/:id Admin
    Shifts POST /shifts/open, /shifts/close, /shifts/:id/close, GET /shifts/active, /shifts Admin / Cashier per role checks
    Reports GET /reports/dashboard, /reports/analytics, /reports/transactions, /reports/export Per endpoint role/tenant scope
    Audit GET /audit-logs, /audit-logs/:id Authorized Admin
    Admin oversight GET /admin/users, PATCH /admin/users/:id/approve, /admin/users/:id/status; dashboard overview/inventory alerts/recent activity Admin/Super Admin as configured
    Offline (deferred) GET /offline/bootstrap, POST /orders/sync Exists but not part of current online release

@Idempotent() is attached to specific writes, including catalog/custom checkout, refunds, payroll process/disburse, advance create, shift open/close, and some stock mutations. Generate one stable key per logical action, not a new key for each retry and not automatically for every CRUD request. 13. Database schema and migrations
The Prisma project uses a multi-file schema at prisma/schema/:
prisma/
├── schema/
│ ├── base.prisma generator + PostgreSQL datasource
│ ├── user.prisma users, roles, account status
│ ├── tenant.prisma businesses, branches, idempotency
│ ├── pos.prisma categories, products, variants, orders,
│ │ refunds, stock, audit, expenses
│ ├── hr.prisma advances, payroll, payroll deductions, shifts
│ └── migrations/ timestamped SQL migrations
└── seed.ts
Important DB constraints
Constraint What it protects
Business @@unique([ownerId, name]) Owner-scoped business name uniqueness
Category @@unique([businessId, name]) Category names within a business
Product @@unique([businessId, name]) Product names within a business
Variant @@unique([businessId, sku]) SKU uniqueness within a business
LocationStock @@unique([locationId, variantId]) One stock row per branch+variant
PayrollRecord @@unique([cashierId, month, year]) One payroll per Cashier/period globally
Expense.payrollId @unique At most one linked Expense per PayrollRecord
IdempotencyRecord @@unique([scopeId, key]) Unique idempotency-key claim per scope
Order.invoiceNumber @unique Global invoice identity

The code also uses many deletedAt columns for soft-delete and historical continuity. Foreign-key onDelete behavior varies by model; do not assume every deletion is physically impossible merely because the application normally soft-deletes rows. 14. Environment, startup and local development
Backend setup
npm ci
cp .env.example .env

# Set required values securely in .env; do not commit secrets.

npx prisma validate --schema prisma/schema
npx prisma generate --schema prisma/schema

# Production/staging: apply checked-in SQL migrations, never reset client data

npx prisma migrate deploy --schema prisma/schema
npm run dev
Use consistent local ports. Backend .env.example defaults to port 3001, while the frontend's dev:frontend command also uses 3001. Choose different ports. For example:

# Backend .env

NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/suntech_pos?schema=public
JWT_ACCESS_SECRET=<random-strong-secret>
JWT_REFRESH_SECRET=<different-random-secret>
JWT_RESET_SECRET=<different-random-secret>
JWT_ACCESS_TTL=7d
JWT_REFRESH_TTL=30d

# Required SMTP and Cloudinary values go here, too.

RUN_BOOTSTRAP_SEED=false

# Frontend .env.local (for context)

BACKEND_API_URL=http://localhost:3000
SUNTECH_SESSION_SECRET=<distinct-random-high-entropy-secret>
Startup config: [`validate-env.ts`](src/config/validate-env.ts) checks required env values and basic port/mode constraints. Do not silently use demo credentials or default JWT secrets. In production configure real frontend origin; don't allow arbitrary browser origins.

Bootstrap seeding: [`SeedService`](src/admin/seed.service.ts) runs automatic bootstrap only when RUN_BOOTSTRAP_SEED=true (and not in test mode). Existing passwords/statuses are not overwritten by its upsert; run intentionally for first deployment, not on every restart.

Do not use prisma db push/destructive reset on a live client database. Back up and verify migrations first. 15. Deployment, testing and constraints
Verification commands
npx prisma validate --schema prisma/schema
npx tsc --noEmit
npm run build
npm test -- --runInBand
npm run test:e2e
npx prisma migrate status --schema prisma/schema
npm run lint is configured with --fix and can change source files; use a non-modifying ESLint invocation for read-only CI checks when needed.
MVP acceptance matrix
Check Reason
Admin selects business B2, branch L2 Multi-business Admin selection works
Admin B1 + branch of B2 rejected Tenant mismatch cannot silently switch scope
Cashier cannot use another business/branch Staff tenancy enforced server-side
Sold variant with insufficient stock still sells Intentional negative-stock policy
Checkout without shift works Intentional MVP workflow
Custom sale leaves variant stock untouched No inferred variant link
Partial/full refund quantity and cash reconciliation No over-refund/double drawer payout
Advance created without shift; no new Expense Ledger separation and business-scoped history
Salary 20k, advances 5k → net 15k Correct advance deduction; 15k payroll Expense
Salary 20k, advance 25k → carry 5k No lost/double advance allocation
Same/different-key duplicate payroll DB uniqueness and idempotency
Run PostgreSQL concurrent checkout/advance/payroll tests Exercise real isolation behavior
Test Dhaka month boundaries Correct period attribution
Backup, restore rehearsal and monitoring Operational readiness

Honest evidence note: These are release acceptance scenarios, not a claim they were all run during README generation. Prior ZIP reviews encountered missing local dependencies; use your configured backend database and CI for real PASS/FAIL evidence.
MVP tradeoffs

- Offline queue/PWA: explicitly deferred.
- Hard stock reservations: not needed; negative stock is intentionally allowed.
- Advanced ledger/accounting: not needed; separate advances, payroll and Expense records are enough for agreed workflows.
- Read replicas, Redis, sharding, microservices: not needed for roughly 100 users without measured bottlenecks.
- Historical accounting: reports and cashflow labels must describe their exact scope and payment-source semantics. Don't overclaim “physical cash” when mixed methods are included.

16. Architecture interviews and scaling decisions
    High-signal interview questions
    Q1 — Why a modular monolith instead of microservices?
    One deployable app, one transactional PostgreSQL boundary and clear modules give enough separation without distributed queues, network failure modes or multiple deployment pipelines.

Q2 — How does business isolation work?
Admins own multiple businesses and send selected business/branch IDs, which are checked against backend-owned resources; Cashiers are assigned one business and branch, validated on JWT-authenticated requests.

Q3 — Are advances user data or business data?
Both: EmployeeAdvance has cashierId and businessId. Payroll similarly links the employee and business. Access filters enforce tenant boundaries. A user belongs to one staff business at a time, while an Admin can own many businesses.

Q4 — Why is payroll unique by employee/month/year and not business/month/year?
The intended rule is one pay period record per Cashier, not one record per business. The current unique key applies globally to that user. This is a modeling choice with implications for mid-month transfers.

Q5 — What does Serializable isolation solve?
It helps protect critical multi-record updates against anomalies under concurrency. The service retries certain serialization conflicts and uses DB uniqueness; transaction design is still necessary, and some external effects require their own failure handling.

Q6 — What is the difference between transaction and idempotency?
A DB transaction maintains consistency within one attempt. Idempotency attempts to recognize repeated submissions of the same logical action across attempts.

Q7 — Why choose whole integer BDT?
It avoids floating-point rounding errors in common Taka calculations. DB integer limits still need overflow checks, and fractional currency rules would need explicit redesign.

Q8 — How does inventory handle multiple branches?
LocationStock has one balance per (locationId, variantId) and checkout mutates the selected branch only; negative quantities are allowed by the current business policy.

Q9 — How would you scale?
Measure query timings, slow reports, DB size and concurrency first; optimize indexes and pagination only where needed, and scale NestJS instances if load justifies it. Add replicas/caching only after evidence of a bottleneck.
90-second explanation
“I developed a multi-business POS with a Next.js frontend, a BFF HTTP boundary and a NestJS modular monolith backed by PostgreSQL and Prisma. The backend uses role guards, DTO validation and tenant-scoped services. Each product has sellable variants, and inventory is tracked per branch. Financial operations such as checkout, refunds and payroll use database transactions and idempotency support to protect against conflicting or repeated requests. Payroll is employee-specific but also business-scoped: advances live in a separate ledger, and eligible outstanding amounts are deducted using persisted FIFO allocations before creating the net salary Expense. I kept the system as one deployable service because the planned user scale doesn't justify distributed complexity. I can explain the tradeoffs, current limitations and how I would measure and scale it if usage grows.”

Companion document: [Frontend architecture, BFF alternatives, JWT vs HMAC and React state management](../frontend/README.md), when both repositories are placed in a shared parent directory. In separate repositories, link their hosted READMEs instead.
