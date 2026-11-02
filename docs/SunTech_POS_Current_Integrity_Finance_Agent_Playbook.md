Suntech POS — FINAL BACKEND-ONLY ONLINE MVP IMPLEMENTATION & VALIDATION PLAYBOOK
Owner-approved policy: November 1, 2026
Replace existing file: docs/SunTech_POS_Current_Integrity_Finance_Agent_Playbook.md
Source snapshot reviewed for guide preparation: backend(20261101-105258).zip
Stack: NestJS 11, Prisma 6 (multi-file schema), PostgreSQL, JWT/RBAC, integer BDT
Scope: BACKEND ONLY. Fix and verify online functionality; no frontend coding, offline/PWA/sync implementation, full general ledger, or new Manager role.
NON-NEGOTIABLE: THIS PLAYBOOK SUPERSEDES ALL OLDER FINANCE/INTEGRITY PROMPTS WHEN THEY CONFLICT. In particular: cashier advances never generate Expenses, never automatically reduce Payroll, and do not need Admin approval or an open shift; Admin supplies explicit required business/branch IDs with no fallback; stock may be negative; online sales are not gated by an open shift. Do not reintroduce superseded requirements just because older audits called them defects.

THIS FILE IS A WORK ORDER, NOT A CLAIM THAT FIXES HAVE BEEN IMPLEMENTED. Re-inspect the repository currently on disk, test actual code, make the minimum correct changes, and report exact evidence. Don't assume code remains identical to this source snapshot.

0. MASTER IMPLEMENTATION INSTRUCTION FOR THE CODING AGENT
You are completing an existing, functioning POS backend for an online-only initial client release. The owner prioritizes correct calculations, correct business/branch scoping, simple predictable APIs, and useful existing features over adding stricter enterprise accounting machinery.
1. Read this file completely. First inspect actual package.json, src/, prisma/schema/*.prisma, prisma/schema/migrations/, relevant tests and current documentation. Do NOT request node_modules, .env, .git, compiled output, or uploads of other bulky generated folders: they are intentionally excluded from uploaded ZIPs and their absence is not a source-code defect.
2. Make a real endpoint/source/DTO/schema inventory before editing. For each acceptance requirement use requirement | route | controller/service/DTO | current status (PASS / FAIL / NOT VERIFIED) | minimal fix | test. Do not copy old bug counts or findings as unquestioned facts.
3. Preserve all beneficial features already implemented (including Super Admin platform features, stock history, audit logs, refunds, images, reports, exports, auth safety, soft deletion, idempotency) unless a specific code path conflicts with the locked policy or is provably broken. Extra useful features are NOT defects just because they are outside the MVP. Don't simplify by deleting modules.
4. Do not implement unnecessary restrictions: no forced positive stock, no mandatory shift for sales or advances, no advance salary ceiling, no auto-advance-payroll deduction, no approval workflow for cashier advances/payroll/manual expenses, no fabricated cash verification, no double-entry accounting module, no mandatory frontend changes now.
5. Keep necessary checks: authentication, authorization, business/branch membership, correct data type and money arithmetic, valid product/variant and quantities, duplicate writes/payment prevention, transactions around dependent database mutations, and consistent historical records. Small validation is useful; invented business gates are not.
6. Implement in Phases 0–6 below. Prefer smallest testable changes; do not refactor unrelated code. After each phase report changed files, old/new behavior, PASS/FAIL/NOT RUN tests, and API contract changes. If using a multi-step agent, complete a phase, report, then proceed to the next instructed phase.
7. If an existing route/DTO/body/query/path/header/enum/response field changes, you MUST output a full copy-paste-ready Frontend API Change Handoff (Section 13) after implementation. Document new and modified endpoints, not only new routes. If none changed, explicitly say No frontend API contract changes.
8. Use additive, safe Prisma migrations. Never reset a user's database, rewrite an already-applied migration silently, delete historical records, or fabricate backfilled history. Database migration upgrade tests must cover both clean DB and existing DB where possible.
9. Do not silently assume an operation was paid in physical cash if payment source is unknown. Do not let bad financial labels make correct arithmetic look wrong.
10. The final output is a concise, evidence-based release result: IMPLEMENTED, ALREADY CORRECT, REMAINING BUG, UNVERIFIED, and DEFERRED, plus actual tests. Do not keep inventing successive blockers after the approved criteria pass. Do not claim production-tested when no DB/runtime tests ran.
Start command for the coding agent
Read docs/SunTech_POS_Current_Integrity_Finance_Agent_Playbook.md in full.
Audit the CURRENT source against its owner-approved rules, treating prior audit findings only as leads.
Complete Phase 0, produce a source-backed gap matrix, then implement Phases 1–6 in order.
Preserve beneficial already-implemented modules and code; change only real mismatches or bugs.
Run actual tests available in your environment and label unrun tests honestly.
Produce the REQUIRED complete frontend API contract handoff for any changed routes, query/body params, headers, DTOs, enums or response shapes.
BACKEND ONLY. No offline/PWA implementation, frontend changes, approval workflows, salary advance auto-payroll deduction or advance-to-Expense posting.
1. LOCKED BUSINESS POLICY — SINGLE SOURCE OF TRUTH
Domain	Required MVP behavior	NOT required / forbidden as a new gate
Admin	For any Admin API that requires business scope, frontend sends businessId; for any Admin branch-scoped API, frontend sends businessId and locationId in the defined query, params or body. Validate both.	No fallback to token's active business, first owned business, actor's old location, first branch, arbitrary branch, or silent default.
Cashier	One assigned business and one branch from verified identity/JWT. Can see relevant catalog and permitted sales, use shifts, create own advances, and list own advances.	Cashier cannot choose another business/branch; no Payroll or Expenses access.
Roles	Store MVP uses ADMIN and CASHIER. One Admin/business is the current operational model; Admin may oversee several branches in that business.	Do not add Manager now; preserve existing Super Admin/platform capabilities and safe pre-existing multi-business support without letting it bypass explicit scope.
Catalog	Existing category/product/variant CRUD; variants are the sellable units; branch stock is shown accurately, including below zero.	No inventory-availability check that blocks sale solely for insufficient on-hand quantity.
Orders	Catalog and custom/free-text sales, correct amounts and payments, orders persisted even when no shift open.	Do not force open shift for checkout; do not deduct a variant for a custom item lacking variant linkage.
Advances	Cashier immediately takes cash, no approval; persist in EmployeeAdvance / Advance Ledger ONLY; subtract once in cash estimates. Admin can list all authorized advances; cashier lists own.	NEVER create Expense from advance; NEVER automatically deduct from Payroll; no mandatory shift, salary cap, post-payroll-month lock or positive-drawer-balance gate.
Payroll	Admin explicitly pays/disburses employee salary. One Payroll record per employee/period, linked one-time PAYROLL_NET salary Expense for amount actually paid.	No extra approval; no automatic advance subtraction, no advance status mutation during payroll.
Manual Expenses	Admin-only CRUD of normal expenses; typed MANUAL and category-based.	Cashier cannot access; cannot manually edit/delete generated payroll Expense.
Admin GET Expenses	Includes only active MANUAL and paid PAYROLL_NET entries, filters by type, category, date, branch, etc.	Exclude SALARY_ADVANCE records even if old rows exist. They remain in separate Advance Ledger/history.
Shift	Simple opening cash, closing counted cash, expected cash, difference, daily cash movements; shift can be optional on sale/advance.	Shift must not gate normal sale/advance. Do not invent a counted amount for an uncounted shift.
Refund	Correct eligible quantity/amount, method/branch and stock policy; cash estimate reduced if cash actually returned.	Do not require open drawer for all refunds, or use original sale shift as a new payout shift.
Reports	Correct sales, refund, stock, advances, expense/payroll and daily cash totals, scoped to business/branch/date.	Never combine unrelated financial numbers into a misleading metric.
Offline	Only keep existing code/API compatible where safely possible.	No offline engine, queue replay, sync API implementation, PWA, device support or offline tests as online launch blockers.


Priority order when unclear: latest explicit owner policy here > actual security/data integrity > existing API compatibility > older playbooks and audit recommendations.
2. IMPORTANT REAL-SOURCE OBSERVATIONS TO VERIFY, NOT BLINDLY COPY
This section identifies code routes from the available snapshot. An implementation agent must check the current repository before applying patches.
- Global prefix in src/main.ts: /api/v1. Actual advance controller is @Controller('advances'): routes are /api/v1/advances, NOT /api/v1/hr/advances.
- Main controllers: src/orders/order.controller.ts, src/catalog/{product,category,variant}.controller.ts, src/hr/{advance,payroll}.controller.ts, src/expenses/expense.controller.ts, src/shifts/shift.controller.ts, src/reports/report.controller.ts, src/tenant/tenant.controller.ts, src/users/user.controller.ts.
- Current AdvanceService.create in src/hr/advance.service.ts checks monthly salary, payroll settled state, open shift, available cash and creates an Expense(SALARY_ADVANCE). These restrictions and Expense projection contradict Section 1. Remove/change those exact parts without breaking actual advance creation, scope or audit history.
- Current PayrollService.processWithin and PayrollService.disburse in src/hr/payroll.service.ts aggregate PENDING advances, update them to DEDUCTED, compute netPaid = salary - advances and create PAYROLL_NET Expenses. Replace auto-deduction with full authorized payroll disbursement and do not change advance states. Both single and batch flows must use the same policy.
- Current Prisma ExpenseSourceType in prisma/schema/pos.prisma has MANUAL, SALARY_ADVANCE, PAYROLL_NET. Keep historical support if needed, but public Admin Expenses default/list/summary must expose only MANUAL and PAYROLL_NET under the new policy. Do not wipe old rows.
- EmployeeAdvance in prisma/schema/hr.prisma has a nullable shiftId but no independent historical locationId in the reviewed snapshot. Advances without a shift need a transaction-time branch snapshot; employee transfers must not rewrite old branch history.
- PayrollRecord in the reviewed snapshot has baseSalary, totalAdvancesDeducted, netPaid, month/year, PAID; the existing @@unique([cashierId, month, year]) is useful. Avoid duplicate paid salary records.
- Existing src/hr/require-business-id.ts, src/common/utils/location-scope.ts, and src/common/utils/tenant-scope.util.ts have Admin fallbacks to token or first owned business. Remove those for operations where explicit Admin context is required, without breaking identity/bootstrap endpoints where a business has not yet been created.
- Main catalog/custom order paths use resolveOrderExecutionContext and support optional shifts. Preserve that. src/orders/order.service.ts still contains insufficient-stock rejects in main and legacy order mutations. Replace with atomic negative-allowing decrements.
- POST /api/v1/orders legacy path has an older DTO (src/orders/dto/create-order.dto.ts) and may silently choose a branch. Verify whether still used; if kept, require correct Admin scope and the same stock/cash rules. Do not remove a route without verifying its consumers.
- ProductService summary must return 0 when the selected branch has no LocationStock record rather than falling back to global variant stock. Check category/variant/product listings consistently.
- ExpenseController currently provides POST, GET, summary GET and DELETE; verify need and implement missing Admin PATCH (and GET by ID if needed for complete CRUD) for MANUAL only without disturbing the existing routes.
- @Idempotent() and src/common/interceptors/idempotency.interceptor.ts exist; Idempotency-Key is currently required on decorated mutations. Preserve useful duplicate protection and document headers for frontend handoff. Avoid spreading mandatory headers to unrelated endpoints unnecessarily.
- src/offline/ is currently present; leave it alone unless an online change would otherwise break compilation. Do not audit/rewrite its sync semantics in this phase.
- Existing SUPER_ADMIN platform lifecycle (including account registration approval) is separate from the forbidden finance approval concept; do not remove working platform functionality.
3. CANONICAL ROLE / SCOPE / VALIDATION CONTRACT
3.1 Admin explicit context (NO FALLBACK)
- For Admin business-scoped operations, require businessId through the endpoint's documented path/query/body; missing, blank, malformed → 400 with a field-specific message. A one-business Admin still sends businessId.
- For Admin branch-specific operations, require both businessId and locationId in the documented request shape; missing either → 400; selected branch must belong to selected business and be active. Token's cached location must never override requested branch.
- Check ownership/authorization, not just existence of IDs. Unowned existing business/branch → 403 (or privacy-preserving 404 consistently); valid format but nonexistent record → 404. No findFirst() branch fallback.
- Business-wide endpoints (GET categories or all-branch analytics, etc.) legitimately use businessId only, with locationId optional as an explicit filter. Do not require location for an intentionally business-wide operation.
- Operations targeting a specific persisted record via its ID may validate business/branch by fetching that record and verifying ownership; document when additional IDs are required. Do not invent duplicate inputs merely for appearance, but do not silently use token/first-business fallback in a route that accepts an explicit business context.
- If an endpoint's old shape lacks required Admin IDs, update its DTO/controller/service and record every new requirement in Section 13's handoff.
Admin example: Admin for B1 sends businessId=B1, locationId=L2 while previously viewing L1: save/read/update only L2. L1 unchanged. Missing locationId on a branch-scoped mutation: 400. L2 in unrelated business: reject. This is not an authentication bug; the IDs are selected by the frontend and authorization is still checked on backend.
3.2 Cashier fixed scope
- Verified Cashier identity must have exactly one assigned businessId and locationId; resolve from authenticated account/JWT and check it is still valid/active.
- Cashier requests should not require redundant IDs. If an input includes business/location IDs, reject mismatches rather than silently accepting and ignoring them.
- Cashier sees only allowed branch catalog/orders and their own advances/history; not another cashier's ledger, Admin expenses, payroll, employee salary data or business-wide sensitive reports.
- Keep any existing masked salary responses and staff-profile security behavior.
3.3 Roles and CRUD permissions
Domain	Admin	Cashier	Security notes
Business and branch setup	Manage authorized business/branches	Assigned branch read only as needed	Preserve platform registration/initial business setup without impossible businessId prereq.
Cashier/staff CRUD	Manage staff in business	Own profile only	No cross-business assignments.
Category/product/variant CRUD, inventory adjustment	Yes	Read for sale	All Admin writes use authorized tenant context; branch stock is branch-specific.
Catalog/custom order	Yes, selected branch	Yes, assigned branch	Shift optional.
Order/refund listing	Authorized business/branches	Own/assigned branch only per actual policy	Prevent record-ID cross-tenant access.
Advance create	No cashier impersonation route unless already authorized & intentionally supported	Yes, self only	No approval.
Advance list/summary	All business advances; filter location, cashier, month/year, state	Own only	Preserve original location attribution.
Advance correction/reversal	Admin authorized correction; preserve audit trail	No arbitrary deletion	Never invent returned cash.
Payroll list/process/disburse	Yes	403	One actual payment per employee/period.
Expense CRUD/list/summary	Yes	403	MANUAL mutable; payroll entries system-managed; no advance rows.
Shifts	Allowed authorized branch/session	Own authorized shift	Shifts are reporting helpers, not sale/advance gates.
Reports	Business/branch-scoped reports	Only existing permitted cashier reports	Salary/finance detail must not leak.


3.4 Minimal useful input validation
- Money: integer BDT, never NaN/Infinity/fraction/negative payment; expenses/advances/payment amount > 0 (zero only where a documented zero-amount result is meaningful). Check overflow and numeric conversion.
- Sale item quantity positive integer; unit prices nonnegative integer; server calculates totals; tenderedAmount/changeDue per payment method. Negative stock balances allowed does NOT mean negative sale quantities or negative selling prices.
- Required names, enum values, pagination limits, date ranges and unique SKU/barcode scoped to proper business.
- Avoid unnecessary maxSalary, prior payroll processed, open shift, physical-cash availability, nonnegative stock, and other policy-blocking validation in cashier advance/sales.
4. REQUIRED BUSINESS FLOWS AND RESPONSE SEMANTICS
4.1 Catalog, variants and inventory
- Categories CRUD with soft archive where implemented. Product listing/search/filter by category, text, status; variant list by product and branch stock. Preserve variant images, SKU/barcode, description, custom attributes if implemented.
- A sellable catalog line always identifies a valid variantId belonging to an active product in the selected business. Existing separate Product-create then Variant-create UI/API may remain; do not require a new atomic product+variant endpoint unless necessary. Prevent selling an unconfigured/no-variant product.
- Stock is tracked by location + variant, not by the latest branch or global stock. Branch with no row → 0. Reports and filters must show negative values without clamping.
- Example: L1 stock = 2, catalog order quantity 5 → sale succeeds, L1 stock = -3, L2 unchanged; global/summary values follow one documented definition. A later receipt +8 → 5.
- Use atomic SQL/Prisma decrement or transaction-safe upsert for missing LocationStock. No stock >= qty guard. A concurrent quantity-2 and quantity-3 sale against balance 2 must lead to -3, not a lost update.
- Admin adjustments can set or change a negative balance if intentionally entered; preserve meaningful movement type and actual before/delta/after values. Ensure metadata edit paths cannot overwrite a concurrent sale with a stale absolute balance. Do not invent a purchasing/warehouse workflow.
- Keep product/category/variant archive safe for historical orders; selling archived/inactive variants should still be rejected as invalid sale items (distinct from insufficient stock).
- Required source comment: // MVP POLICY: negative branch stock is intentionally allowed for online sales/adjustments; do not add availability rejection until owner enables strict stock mode. Add comment near authoritative mutation path and note in developer-facing output, not repeatedly throughout code.
4.2 Catalog checkout, custom checkout and payments
- POST /api/v1/orders/catalog: selected Admin branch (explicit IDs) or cashier fixed branch; validate each variant and correct backend price, calculate integer totals, create order/lines, atomically decrement branch stock, record one movement per intended mutation, and return persisted amounts/branch/invoice.
- POST /api/v1/orders/custom: free-text product/service item, quantity, unit price, selected branch and payment method; do not require a catalog variant; do not change variant inventory unless a real variant relationship is explicitly present and supported.
- Existing payment methods in schema: COD (physical cash), BKASH, NAGAD, BANK. Preserve accepted alias behavior only if safe; document definitive field to use. COD cash affects drawer estimates; electronic methods are sales but not physical drawer cash.
- Validate client-supplied prices against existing backend price policy, not by trusting arbitrary catalog price from client. Preserve quantity and rounding in whole BDT, calculate subtotal/total/change exactly once.
- Do not require open shift. Associate an existing valid shift where available. If absent, save order with shiftId=null and correct branch/timestamps; branch/day reports must still find it. If client sends a foreign/mismatched shiftId, reject misuse instead of attaching to another branch. An already-closed shift cannot receive new activity.
- Legacy POST /api/v1/orders: either make it follow the same role/branch/stock rules while preserving clients or prove unused and document deprecation. Never choose an arbitrary first branch.
- Duplicate online submissions: retain useful idempotency key support and unique invoice handling. Same idempotency key + same payload → same result/one order; same key + different payload → conflict; server error after DB commit must not make duplicate money/order write on retry. Do not add unrelated offline infrastructure.
Illustrative Admin request (verify latest DTO first):
POST /api/v1/orders/catalog
Authorization: Bearer <admin-token>
Idempotency-Key: <unique-key-for-this-checkout>
Content-Type: application/json
{
  "businessId": "B1",
  "locationId": "L2",
  "paymentMethod": "COD",
  "tenderedAmount": 3000,
  "lines": [{"variantId": "V1", "quantity": 5, "unitPrice": 600}]
}
Expected: one paid catalog order for B1/L2; L2 stock decreases by 5 even below zero; cash impact +3000 BDT (assuming changeDue=0); L1 unaffected; may have shiftId=null. The example IDs are placeholders, not required ID format.
4.3 Refunds
- Allowed actor and order must be in same authorized business/branch. Refund quantity cannot exceed original sold qty minus previous refunded qty, across concurrent requests; paid amount cannot be refunded beyond eligible original money.
- Correct OrderStatus/partial versus full refund, historical item snapshots and net-sales calculations. Do not double-refund after retry.
- Refund payment/cash handling follows actual payout method and branch, not automatically original sale shift. Cash refund reduces physical cash estimate; bKash/Nagad/Bank should not reduce physical cash estimate. Do not force open shift merely to save a legitimate refund.
- Re-stock a catalog variant only if the existing explicit return-to-inventory policy permits it and exactly once; never mutate variant stock for a free-text custom order without a variant link. Document any existing rule.
- Preserve original sale's historical records; use refund event to adjust current-period cash movement when appropriate.
4.4 Cashier Advance Ledger — SEPARATE FROM EXPENSES AND PAYROLL
Sequence: CASHIER posts amount → backend identifies cashier and assigned business/branch → saves one advance withdrawal and audit → cash estimate reduced exactly once → GET advances shows the history. No Admin approval, payroll deduction, or automatic Expense record.
- Existing route: POST /api/v1/advances (Cashier only); body at minimum { "amount": 2000, "reason": "Optional reason" }. Resolve business/location from authenticated cashier, not frontend-selected context.
- No monthly salary maximum, no "payroll already paid this month" lock, no open shift/cash-in-register minimum check. Only valid positive integer amount, valid active cashier/branch, proper authorization, and duplicate submission protection.
- Persist cashierId, businessId, withdrawal-time locationId, amount, reason, takenAt, and optional valid shiftId if available. For cashier later transferred to another branch, old history stays with original branch. If schema lacks locationId, add a minimal nullable/additive migration and write it for all new entries.
- An open shift is optional. If found and appropriate, link; if not, shiftId=null and record still valid. Branch/day cash report MUST still subtract the withdrawal based on its location/time; do not lose it because shiftId is null.
- No tx.expense.create for new advances. Remove advance-generated Expense projection from write flow (without deleting old data). Do not update PayrollRecord, AdvanceStatus.DEDUCTED, salary dues or payroll net amount automatically.
- Current AdvanceStatus.PENDING may be retained as a legacy storage label for 'taken and not reversed', but it MUST NOT be presented as an approval queue or trigger payroll. If an API-facing TAKEN/VOIDED presentation is added, document precisely in handoff; don't blindly rename production enums.
- GET /api/v1/advances:
  - Cashier: only self history; requested cashierId for another employee must not alter the scope. Ideally reject such override clearly.
  - Admin: all advances for explicitly supplied owned businessId, optionally filter locationId, cashierId, month, year, date range, status, pagination. Include cashier display name, branch snapshot, amount, time and reversal status; return useful period totals.
- GET /api/v1/advances/summary: advance totals/history only. Remove misleading automatic netPayable/`baseSalary - pendingAdvances` financial conclusions; retain fields only if explicitly labeled legacy/deprecated for compatibility and report the response change.
- Void/reversal: No physical cash should disappear from history. If a withdrawal was genuinely taken, correcting it must record whether and when money was returned; a later return affects the return date's cash, not retroactively rewrite yesterday's closed shift. For an entry that was never a true withdrawal, Admin may correct/void with an audit reason; preserve original record and adjustment trail. Do not turn a soft-delete into fictional physical cash returned. Implement minimal safe correction semantics; no full general ledger required.
- Existing older Expense(sourceType=SALARY_ADVANCE,advanceId=...) rows may be present. Do not auto-delete or rewrite them. Exclude from active public Expenses reports by source filter; preserve them for historical audit/reconciliation, clearly mark legacy if surfaced elsewhere.
Example: Cashier has a previous monthly salary of 20,000 BDT; takes 5,000 BDT advance now. Advance Ledger +5,000 taken, estimated branch/day cash -5,000. GET /expenses unchanged. Later Admin pays full 20,000 BDT payroll; the advance stays separate and unaffected. The resulting total physical outflow may be 25,000 BDT if both were paid in cash; this is intentional current policy, not auto-reconciled salary.
4.5 Payroll — Admin paid disbursements only
- GET /api/v1/payroll, /payroll/history, /payroll/summary: Admin only; businessId explicitly required; optional locationId for branch filter; preserve payroll month/year, salary, paid status and employee information.
- POST /api/v1/payroll/process for one cashier and POST /api/v1/payroll/disburse for batch: inspect actual DTOs, keep working routes and semantics where possible, both must implement the same no-auto-advance policy.
- Admin action is actual disbursement, not an approval. No new approval stage. For a standard salary: baseSalary=20000, totalAdvancesDeducted=0, netPaid=20000 unless a separate explicitly supported approved manual pay amount already exists; do not automatically scan/mark/consume advances.
- Create one PayrollRecord and one linked Expense(sourceType=PAYROLL_NET, category=SALARIES, amount=netPaid) on successful paid disbursement. Expense userId is Admin performing the action; beneficiaryCashierId identifies employee; preserve original location at disbursement. No Payroll Expense before payment.
- If a true zero payout is ever valid, don't invent a positive Expense; document record semantics. If failure at expense write, rollback paid payroll record. Protect uniqueness for single and batch overlap/retries, with atomic database transaction.
- Batch: valid cashier list for selected business/branch(s), don't pay noneligible employees twice; if some already paid, return an understandable per-employee result or documented atomic behavior—never silently duplicate.
- Historical records must remain in original branch/month even after staff transfer, removal, salary edit, or later payroll periods. Preserve original salary snapshots; do not recompute an already-paid record using current salary.
- Payment method for cash reporting must be explicit where payment source affects drawer (CASH / existing payment enum mapping vs noncash). If current schema lacks payout method, add only minimal metadata needed to know whether actual cash left branch; do not build a payment-account ledger. Legacy unknown payment sources remain UNKNOWN for drawer calculations, not automatically cash.
Example: Cashier salary 20,000 BDT, advance ledger had 5,000 BDT. Admin disburses: Payroll PAID, netPaid=20000, totalAdvancesDeducted=0; new Payroll Expense 20,000 BDT; advance still shows 5,000 BDT separately.
4.6 Manual Expense CRUD and Admin consolidated Expense GET
- Manual POST /api/v1/expenses: Admin only; set sourceType=MANUAL, category selected from valid ExpenseCategory, amount, title, note, spentAt, explicit businessId, and explicit locationId when branch-specific. Business-wide expenses with no branch should remain valid only if endpoint explicitly models them; don't guess a branch.
- Complete practical manual CRUD: list, detail as needed, create, edit (PATCH /expenses/:id if missing), soft delete. PATCH must validate positive amount/owned branch/category/date and only allow MANUAL; payroll Expenses are immutable via manual CRUD. Updates/deletions must correctly affect summaries.
- Payroll disbursement automatically writes PAYROLL_NET Expense once. Advance never writes Expense. Past legacy SALARY_ADVANCE rows are excluded from current public list and summary.
- GET /api/v1/expenses includes MANUAL + PAYROLL_NET only, with independent type, category, month/year or date range, optional branch and search/pagination. Admin businessId required. Each row contains readable type/`sourceType`, category, amount, location, date, actor, and beneficiary for payroll as available.
- GET /api/v1/expenses/summary uses the exact same source-type and tenant/date filters; total = sum of visible included records, byType and byCategory reconcile to total. No false extra sums. GET /expenses?type=SALARY_ADVANCE must NOT expose old advances; return a clear 400 unsupported expense type (recommended) and document it, rather than producing phantom totals.
- Preserve actual enum name PAYROLL_NET if changing to PAYROLL would create unnecessary migrations; UI can label it “Payroll”. Keep MANUAL stable. Do not add an ADVANCE expense type to the active Expenses API.
- If manual expenses can be paid in cash or noncash, expose the smallest payment-method field needed for cash reporting. A legacy expense with unknown payment source must not be assumed to be drawer cash.
- Avoid expensive unbounded list/summary payloads; paginate list with clear totalCount, compute summary totals in DB where practical. Extend responses compatibly if feasible; any field-shape change goes into frontend handoff.
Example combined Admin view: Manual Rent 1,000 + paid Payroll 20,000 → GET /expenses total 21,000. Cashier advance 5,000 is NOT there and NOT included in totalExpenses or byType. The advance appears only in GET /advances/cash-report outflow.
4.7 Shifts and cash estimates — simple, not restrictive
- POST /api/v1/shifts/open records opening float (>= 0); POST /shifts/close / /:id/close records actual counted closing cash and variance; GET /shifts/active and history report estimated cash and movements.
- Do not block catalogue/custom sale, salary advance, refund or ordinary permitted operation because no shift is open. When a valid shift is open, link operational event if appropriate; otherwise store business, branch, actor and actual event time for branch/day estimates.
- Cash estimate formula for a given branch/day or correctly linked open shift:
expectedCash = openingCash
             + physically collected cash sales (COD, net of change)
             - cash refunds actually paid
             - cashier advances actually withdrawn
             + cash advances actually returned (if any)
             - manual expenses actually paid from cash drawer
             - payroll actually paid from cash drawer
             + other EXPLICIT, VERIFIED cash corrections if supported

variance = physicalClosingCount - expectedCash
- All physical movements count once. BKASH/NAGAD/BANK are not physical drawer cash. An Expense record is not a second cash movement if Payroll is already recorded as the same event. Do not subtract the payroll Expense and PayrollRecord twice.
- If a transaction has no shift but valid branch/day metadata, include it in branch/day cash movement. For a particular shift report, include only events reliably attributable to that shift; don't falsely assign unlinked events to a closed shift. Clearly distinguish branchDailyCashEstimate from shiftExpectedCash if necessary.
- Real closing count is never silently set equal to expected amount. Historical closed shifts retain reported counted cash and discrepancy. If overnight shift auto-close exists, preserve functionality but don't invent counted cash.
- Showing a negative estimated cash balance is permitted as an indicator/warning, not a reason to reject ordinary operations. Likewise offline scenarios in the future should not drive today's open-shift gating.
Arithmetic test: opening 5,000 + cash sales 10,000 − advances 2,000 − cash manual expenses 1,000 − cash refunds 500 = 11,500 BDT expected; actual count 11,200 → -300 BDT variance. When payroll is paid by bank, subtract 0 from drawer; when paid in cash, subtract its paid amount once.
4.8 Reports, analytics, audit, exports
- Admin business/branch/date filters: gross paid sales, refunds, net sales (gross - refunds), payment-method amounts, branch stock (including negative), low-stock alerts, stock movements, Advance Ledger withdrawals/returns, paid payroll, manual Expenses and total Expenses, optional daily cash estimate and shifts.
- Do not mix: sales revenue, business Expenses, advances and physical drawer. Advances lower physical cash but are not Expense; payroll Expense counted once, cash outflow only when physically paid in cash.
- Refunds should affect net-sales/reporting according to documented order-vs-refund date boundaries, without falsely changing an original sale's transaction date. Zero activity → zero totals, not errors.
- Date/month reporting must use one correct timezone policy for Dhaka retail operations (Asia/Dhaka with UTC persisted); boundaries are inclusive start/exclusive end. Historical month totals must remain stable.
- Preserve PDF/CSV exports, audit-log read paths, auth/role protection, and existing dashboard features. Correct obvious figures; don't redesign unrelated analytics.
- Audit meaningful money/stock changes with actorId, actual business/location, source record ID and action, without leaking secrets. Do not require a full finance journal.
5. REQUIRED EDGE CASES / ACCEPTANCE MATRIX (AUTOMATE WHERE POSSIBLE)
Identity and scope
- [ ] Admin assigned B1, frontend sends B1/L2 while UI was previously at L1: writes/read affect only L2. No token fallback.
- [ ] Admin branch-scoped write missing businessId OR locationId: 400, no write; missing business on business-wide GET: 400.
- [ ] Admin sends existing B2 they do not own or L3 from B2: reject, zero cross-tenant reads/writes.
- [ ] Cashier token B1/L1 cannot set B1/L2, B2/L2, another employee ID or Admin salary/expense routes.
- [ ] Invalid/deleted business or location, suspended user and malformed ID rejected consistently; unrelated by-ID operations cannot leak data.
- [ ] Business creation/bootstrap still works for an Admin who has not yet created the business; platform SUPER_ADMIN paths still work.
Catalog, variants and stock
- [ ] Branch absent LocationStock row displays 0, not global stock; branch-specific summary and listing agree.
- [ ] Sale 5 when branch stock 2 → stock -3, order saved; other branches unchanged; negative is displayed in GET.
- [ ] Two parallel orders qty 2 and 3 when stock 2 → final -3 with both movements/order quantities (no lost update).
- [ ] Sale with zero/negative quantity rejected; sold-out variant allowed, but inactive/deleted/cross-business variant rejected.
- [ ] Add stock +8 to -3 → 5; adjustment metadata and movement reflect true difference; concurrent adjustment vs sale doesn't overwrite sale.
- [ ] Custom free-text order doesn't affect stock; no-variant product isn't sellable; category/name/status filters return correct scope.
- [ ] Product/variant archive preserves historical order line names/prices; SKU/barcode uniqueness remains proper.
Checkout, payment, refunds
- [ ] Admin B1/L2 sale without open shift succeeds, saved with L2 and shiftId=null; COD cash included in branch/day report.
- [ ] Cashier without shift sale succeeds; linked valid shift sale remains linked. Foreign/closed shift is not silently used.
- [ ] COD vs bKash/Nagad/Bank does not mix drawer cash; tendered/change math and backend-price validation pass.
- [ ] Duplicate submit/lost HTTP response/retry does not create two orders; conflicting idempotency-key payload fails.
- [ ] Partial refund quantities across separate requests never exceed sold qty; parallel refund not overpaid.
- [ ] Cash refund without shift is valid branch/day outflow; noncash refund isn't drawer outflow; no attribution to old sale shift.
- [ ] Refund totals reconcile gross/net sales and original/returned stock policy.
Advance Ledger — owner policy
- [ ] Cashier can take +2,000 BDT advance even with no shift, no monthlySalary, payroll already paid or insufficient estimated cash; save branch and time.
- [ ] Advance POST returns one ledger row; cash estimate decreases 2,000 exactly once; expense count/amount does not change; payroll due/paid amount and advance statuses do not change.
- [ ] Cashier GET advances returns only self; Admin GET businessId B1 returns all B1 employees (branch, cashier, month/year filters). Admin cannot see B2.
- [ ] After cashier transfers from L1 to L2, prior advance still belongs to L1; monthly/branch history stable.
- [ ] Retry identical POST cannot create duplicate cash withdrawal; bad negative/zero/decimal amount rejected.
- [ ] Reversing a recorded withdrawal preserves audit and actual cash chronology; later returned money counts on return date; fake soft-delete never silently boosts closed historical drawer.
- [ ] Existing historical SALARY_ADVANCE Expense projections remain stored for audit but excluded from new Expenses GET/summary. No automatic destructive migration.
Payroll and Expenses
- [ ] Admin pays salary 20,000 even after employee took 5,000 advance: payroll PAID, totalAdvancesDeducted=0, netPaid=20000, one PAYROLL_NET Expense 20,000; advance remains separate.
- [ ] Both single /payroll/process and batch /payroll/disburse obey same policy; duplicate period pay and concurrency safely detected.
- [ ] Cashier GET/POST payroll/expenses returns 403.
- [ ] Manual Expense 1,000 + Payroll Expense 20,000 → summary totalExpenses=21000, byType/byCategory reconcile; Advance 5,000 excluded.
- [ ] GET /expenses?type=MANUAL, ?type=PAYROLL_NET, ?category=SALARIES use correct distinct filters; legacy type=SALARY_ADVANCE cannot reveal advance entries.
- [ ] Admin can create/edit/delete MANUAL; payroll-generated Expense can't be manual edited/deleted; failed payroll Expense insert rolls back PayrollRecord.
- [ ] Bank-paid payroll leaves drawer unchanged; cash-paid payroll subtracts exactly once, not once from Payroll and again from Expense.
- [ ] Staff salary change, transfer or archive doesn't alter already-paid payroll history/branch/amount.
Shifts, reports and deployment
- [ ] Opening 5,000 + cash 10,000 - advance 2,000 - manual cash expense 1,000 - cash refund 500 = expected 11,500; close actual 11,200 → variance -300.
- [ ] No shift operation still appears in correct branch/day report; shiftless money event isn't invented inside an unrelated closed shift.
- [ ] Empty lists, zero activity periods, daylight/month boundaries and negative stock/net sales handled without crashes/clamps.
- [ ] Payment method, branch, date, month filters consistently affect summaries and detailed rows.
- [ ] Prisma fresh migration, upgrade migration, typecheck/build, unit tests and real PostgreSQL online E2E pass where infrastructure is available; record NOT RUN where unavailable.
6. IMPLEMENTATION PHASES (BACKEND ONLY)
PHASE 0 — Inspection, matrix and compatibility baseline
Inspect: current repo package.json, full controllers+DTOs+services, prisma/schema, migration history, included tests, current docs/POS.md, existing Finance Playbook notes. Verify each real route and actual roles (do not take previous response samples as authoritative).

Deliver: (a) endpoint inventory with role and required Admin scope; (b) policy mismatch matrix identifying existing/bug/missing/obsolete restriction; (c) preserved useful features list; (d) tests available and initial results. Do not implement unrelated audit suggestions.

Stop/continue gate: each requested feature mapped to actual code; known mismatches prioritized; no code rewritten on guesses.
PHASE 1 — Business/location scoping and role security
Target files: src/auth/strategies/jwt.strategy.ts, src/common/utils/{tenant-scope.util,location-scope}.ts, src/hr/require-business-id.ts, relevant controllers/DTOs/services in tenant, catalog, orders, hr, expenses, shifts and reports.
1. Explicit Admin businessId and branch-specific locationId: required at correct endpoints, no fallback (even for one-business Admin). Enforce ownership and branch membership.
2. Cashier uses one assigned context and no cross-branch override. Restrict Cashier to permitted operations, own advances and non-financial views.
3. Map all Admin GET queries and write DTOs; be precise on business-wide vs branch-specific scope. Preserve account bootstrap, Super Admin and beneficial multi-business code if present.
4. Implement tests of Admin L1→L2 selection, missing IDs, mismatched IDs, stale token vs selected location, by-record cross-tenant access.
Done when: all tenant-dependent paths are tested against scope matrix, and no missing Admin required ID triggers a first-business/first-branch guess.
PHASE 2 — Catalog, branch stock, sales and refunds
Target: src/catalog/{product,category,variant}.service.ts, related DTOs, src/orders/{order,refund}.service.ts, controllers, prisma/schema/pos.prisma only as truly required.
1. Verify CRUD, listing, names, variants, filters and soft archives; preserve images and existing attributes.
2. Make all active online and legacy checkout stock paths negative-allowing and atomic. Remove insufficient stock rejects and guarded stock >= qty; use exact selected branch and valid variant. Fix false global-stock fallback for empty branch stock.
3. Keep custom/free-text sale with no stock update and both catalog/custom checkout shift-optional. Correct payment/change/cash calculation, invoice, historical snapshots, duplicate writes.
4. Make stock manual adjustments and variant edit stock changes transactionally consistent with sales; preserve stock movement history.
5. Verify refunds and correct branch/payment cash effect; do not require open shift. Audit stock, payments and refunds at reasonable level.
6. Document one local comment for intentionally negative stock and future strict-mode option (not implemented now).
Done when: matrix of catalog, custom, cash, noncash, negative stock, concurrent stock, refunds and Admin B1/L2 checkout passes.
PHASE 3 — Advance Ledger and lightweight shifts
Target: src/hr/advance.service.ts, src/hr/advance.controller.ts, src/hr/dto/*advance*, src/shifts/{shift.service,shift.controller}.ts, prisma/schema/hr.prisma with safe migration only if needed.
1. Keep Cashier self-service POST /advances and no Admin approval. Remove monthlySalary cap, payroll-settled block, active shift/balance hard gates. Keep amount/identity validation and duplicate-write safety.
2. Delete only new advance→Expense creation behavior, not historical data; no payroll writes. Add/persist historical withdrawal branch snapshot and nullable valid shift association. Prefer typed Prisma transactions over optional tx.expense?.create or mock-only guards.
3. GET advance self history and Admin business-wide filter/pagination; correct employee/branch/period totals. Stop following employee's current branch for history.
4. Reversal/void corrects cash only via documented real-world correction, preserved record and audit. Avoid phantom cash return on soft delete.
5. Shift and daily cash estimates subtract advances exactly once even without an open shift; preserve open/close actual count/variance, no invented cash count.
Done when: no advance causes Expense or Payroll mutation; shiftless advance is visible and affects branch/day estimated cash; Cashier own/Admin all permissions verified.
PHASE 4 — Admin Payroll + Manual Expenses
Target: src/hr/payroll.service.ts, src/hr/payroll.controller.ts, payroll DTOs, src/expenses/{expense.service,expense.controller}.ts, DTOs, prisma/schema/{hr,pos}.prisma, safe migrations if needed.
1. Remove automatic PENDING advance scans, DEDUCTED updates, netPaid = baseSalary - advances calculations in BOTH single and batch payroll. Preserve historical payroll records/statuses and meaningful manual paid amount only if explicitly supported.
2. Successful Admin disbursement creates one PAID Payroll record + one linked PAYROLL_NET SALARIES Expense of paid amount atomically; failed Expense insert rolls back payment. No duplicate pay by retries or process/disburse race.
3. Add minimal transaction-time branch/payment source metadata where actually required for accurate reporting. Do not invent account reconciliation/funding approvals.
4. Complete MANUAL Expense CRUD and validate the source type. Filter Expenses list/summary to MANUAL, PAYROLL_NET only; legacy SALARY_ADVANCE hidden from active totals with history preserved.
5. Add independent type/category/branch/date filters and server-side correct totals. Prevent editing/removing payroll Expense directly.
6. Verify no double subtraction of payroll in drawer/cash reports, and noncash payment correctly excluded.
Done when: salary 20k + separate advance 5k produces payroll expense 20k and unchanged advance; manual + payroll totals match exactly.
PHASE 5 — Dashboard, reports, audits and edge-case stabilization
Target: src/reports/*, src/admin/admin-dashboard.*, src/common/audit/*, src/shifts/*, only relevant supporting services.
1. Align business/branch/day/month filter semantics and Dhaka time boundaries; use consistent source-of-truth amounts.
2. Ensure correct gross paid sales, refunds, net sales, payment methods, stock/negative stock, advances separate from expenses, manual/payroll Expense totals, cash estimate vs other metrics.
3. Preserve beneficial PDF/CSV exports, audit logs and other already-correct features. Don't require a new dashboard/UI redesign.
4. Identify duplicate queries, any/mock fallbacks, and unnecessary validations only where they cause a real bug or maintainability risk. Prefer focused simplification.
5. No new roles, accounting journals, offline sync workflows or unrelated architectural changes.
Done when: sample cash and business totals match detailed underlying transactions, including no-shift transactions and staff transfers.
PHASE 6 — Tests, migration safety, release gate and frontend API handoff
1. Run npm ci only where dependency install is permitted; inspect package.json scripts. Recommended: npx prisma validate --schema prisma/schema (confirm correct multi-file schema configuration), npx prisma generate, npm run build, npm test -- --runInBand, and online integration/E2E tests against a disposable PostgreSQL DB.
2. Use npx prisma migrate deploy against (a) clean DB and (b) sanitized clone / existing schema upgrade. Inspect _prisma_migrations; if an edited earlier migration has already run, add a new corrective migration, never mutate history in place and assume it reruns.
3. Exercise authorization, cash arithmetic, concurrent stock, duplicate submit, advance-history transfer, batch vs single payroll, refunds and expense summary tests against persisted database state (not mocks alone).
4. Classify results PASS, FAIL, NOT RUN with commands, concise output/evidence. If DB/credentials unavailable, source/unit readiness is all that can be claimed; state exactly what still requires runtime verification.
5. Produce Section 13 frontend API change handoff and point to changed Swagger DTOs. Update the existing playbook's progress section only, not many competing reports. Avoid destructive test data operations against production.
Done when: no policy-relevant P0 bugs remain in inspected source; real runtime checks pass where available; every frontend-relevant contract change is explicit and copy-pasteable. A feature tested with only mocks is NOT marked PostgreSQL-verified.
7. EFFICIENT CODE REVIEW / UNNECESSARY COMPLEXITY RULES
Remove or simplify only when source proves it is wrong or harmful:
- Old advance restrictions: require open shift, require enough estimated drawer cash, require configured monthly salary, require not-yet-paid payroll month, advance→Expense creation, advance→payroll deduction.
- Online insufficient-stock rejects on sale; inventory clamp to zero, branch fallback to global stock, first-branch Admin fallback.
- Duplicate code paths that compute the same money differently; optional Prisma delegates/`any`-casts that silently skip a required payroll Expense or cash movement in real production.
- Unbounded lists that cause a verified performance issue; needless N+1 and repeated recalculation in important reporting endpoints; fallback to fake totals or fabricated cash count.
- A validation that exists only because older finance playbook demanded approvals, positive stock, open shift or a general ledger.
Keep beneficial and correct extra implementation: registration/security flows, Super Admin, audit logs, media, exports, optimized filters, variants/images, staff lifecycle, shift history, refund controls, idempotency, optional offline-ready IDs already in schema. Do not rip out good functionality because it's beyond the listed MVP.

Avoid: rewriting Prisma architecture, replacing ORM, changing money to floats, new microservices, event bus/queue, compulsory new roles, new UI, or whole-system refactors to solve a localized bug.
8. DB/MIGRATION & HISTORICAL DATA SAFETY
- Prisma schema is multi-file (prisma/schema/base.prisma, hr.prisma, pos.prisma, tenant.prisma, user.prisma); inspect package config and correct validation/generate commands.
- New advance locationId snapshot and optional cash method/return event metadata should be minimal, additive, nullable where needed for historical records; new writes must be complete. Verify relations/unique indexes, onDelete behavior, query indexes and type generation.
- No destructive reclassification of old advances and salary Expenses. Historical SALARY_ADVANCE Expense rows may still exist; exclude them in active GET/summary. Leave linked old PayrollRecord(totalAdvancesDeducted > 0) as historical facts: only new payroll follows no-auto-deduction policy.
- Legacy history with unknown location or payment method must remain unknown unless safely inferable from existing shift/order links; don't pretend current employee location is original.
- If a duplicate payslip/order/advance already exists, investigate and propose a narrowly scoped safe correction; no automatic production data deletion.
- Migrations applied in production may have a checksum and not rerun if SQL edited. Create new corrective SQL migration and test upgrade rather than rewriting an applied migration.
- Respect one-business Admin current operation while preserving safe ownership relation and useful multi-branch schema.
9. CURRENT API INVENTORY — VERIFY AND UPDATE, DON'T ASSUME
Global REST prefix: /api/v1 (from reviewed src/main.ts). Route names below are source-discovered existing paths, but final DTO/body/query requirements must be verified against current branch after implementation.
Area	Existing routes / endpoints	Backend policy check
Auth	/auth/login, /auth/refresh, /auth/logout, etc.	JWT/role/active status; preserve.
Tenant	/tenant/businesses, /tenant/business, /tenant/locations, etc.	Explicit required Admin context for scoped operations, no bootstrap deadlock.
Staff	/users/cashiers, /users/me, etc.	Admin owns business; Cashier own profile only.
Catalog	/catalog/categories, /catalog/products, /catalog/variants, variant stock/images routes	CRUD/filter, branch stock, negative balances, authorized scope.
Orders	POST /orders/catalog, POST /orders/custom, POST /orders (legacy); GET /orders, GET /orders/:id	Explicit Admin business/branch, cashier fixed branch, optional shift, payments.
Refund	POST /orders/:id/refunds	Eligible quantity/amount, actual cash or noncash outflow.
Advance	POST /advances, GET /advances, GET /advances/summary, DELETE /advances/:id	Cashier self create/read, Admin read all/authorized correction; NO Expenses, NO payroll mutation.
Payroll	GET /payroll, GET /payroll/history, GET /payroll/summary, POST /payroll/process, POST /payroll/disburse	Admin disbursement and one PAYROLL_NET Expense; no auto advance deduction.
Expenses	POST /expenses, GET /expenses, GET /expenses/summary, DELETE /expenses/:id; add PATCH /expenses/:id if missing	Admin manual CRUD, GET MANUAL+PAYROLL_NET, category/type filters.
Shifts	POST /shifts/open, GET /shifts/active, POST /shifts/close, POST /shifts/:id/close, GET /shifts	Simple cash estimates; not a sale/advance gate.
Reporting	/reports/dashboard, /reports/analytics, /reports/transactions, /reports/export, /admin/dashboard/...	Correct tenant scope, accurate financial labels.
Audit	Existing audit read API in src/common/audit	Preserve.
Offline	Existing /orders/sync, /offline/...	DEFER. Do not modify or test for this release unless necessary for compilation safety.


Do not send a fake finalized API specification to frontend: after code changes, retrieve the actual controller+DTO+response definitions and fill the precise contract in Section 13.
10. EXPECTED ERROR AND DATA-CONTRACT CONVENTIONS
- 400: missing or malformed required Admin businessId/locationId, invalid quantity/amount/payment/period, missing required field.
- 401: no/expired/invalid authentication.
- 403: unauthorized business/branch, Cashier outside assigned scope, Cashier trying Admin payroll/expenses, role mismatch.
- 404: legitimately nonexistent entity scoped to authorized tenant. Consistency/security takes priority over disclosing cross-tenant existence.
- 409: duplicate salary payment, duplicate/conflicting idempotency key, real concurrent resource conflict, duplicate SKU/barcode.
- 2xx: actual confirmed persisted effect; no fake success on partial DB writes.
Preserve existing common response envelope from Nest interceptors where possible. Don't silently change it; if changed, describe exact before/after example in the API handoff.

Do NOT return: success while Expense insert failed after payroll marked paid; success after stock decrement without order insert; a Cashier's data from another branch; an arbitrary business/branch in absence of required Admin scope; a summarized Expense total including advance rows.
11. SAMPLE NUMERIC RECONCILIATIONS (TEST FIXTURES)
Scenario A — Stock negative and branch isolation
B1, L1, V1 stock=2; B1, L2, V1 stock=9.
Admin selects businessId=B1, locationId=L1 and sells qty=5.
Result: L1=-3; L2=9; paid order quantity=5; stock movement=-5.
Second receipt/restock L1 +8 -> L1=5.
Scenario B — Advance only, no automatic Expense or Payroll
Cashier B1/L1 takes BDT 5,000, no open shift.
EmployeeAdvance created exactly once, branch snapshot L1.
Cash movement: -5,000 for L1 on take date.
Expense count/change: 0.
PayrollRecord change: 0; advance is NOT auto-marked DEDUCTED.
GET /advances as Cashier: own row; as Admin of B1: row visible.
Scenario C — Payroll plus manual Expense
Base salary: BDT 20,000; separate prior advance: BDT 5,000.
Admin pays salary BDT 20,000 (no auto deduction).
PayrollRecord: PAID; totalAdvancesDeducted=0; netPaid=20,000.
New Expense: sourceType=PAYROLL_NET, category=SALARIES, amount=20,000.
Manual Expense: sourceType=MANUAL, category=RENT, amount=1,000.
GET /expenses: exactly these 2 active rows, total=21,000.
GET /advances: still has the 5,000 advance; not included in Expenses.
Scenario D — Branch/day physical cash
Opening 5,000; COD cash collected +10,000; BKASH +9,000 (NOT drawer cash).
Advance withdrawal -2,000; MANUAL paid by cash -1,000; refund cash -500.
Payroll paid via BANK 20,000 (NOT drawer cash).
Expected cash = 5,000+10,000-2,000-1,000-500=11,500.
Actual counted = 11,200; variance = -300.
The Expense total and physical cash are DIFFERENT measures.
12. RELEASE VERDICT RULES — STOP THE ENDLESS AUDIT LOOP
Return one of the following evidence-based outcomes:
1. ONLINE MVP SOURCE-READY (runtime unverified): required policy code paths and unit tests appear correct, but DB/migrations/E2E not run; list exactly what was not run. This is NOT a real-money production certification.
2. ONLINE MVP CLIENT-TEST READY: app compiles; intended migrations and core role/order/advance/payroll/expenses flow tests actually pass against safe test environment; remaining issues are nonblocking or deferred. Label test environment.
3. BLOCKED: a specific reproducible, policy-relevant issue still corrupts/loses money, lets tenant access leak, prevents normal operation, or breaks migration/build. Cite exact source/API and reproduction. Do not list optional future offline features or intentionally permitted negative stock as blockers.
Once Phase 6 is completed, only report new proven regressions or unmet acceptance checks. Stop calling intentional product policy a bug. An old audit P0 is NOT automatically a current P0 unless it conflicts with this guide and still exists in current code.
13. REQUIRED FRONTEND API CHANGE HANDOFF (PRODUCE AFTER IMPLEMENTATION)
The backend coding agent MUST provide this in its final chat message, in one clearly copy-pasteable Markdown section. Append/update it within this same playbook if helpful. Do not create competing finance playbooks or frontend implementations. The user will paste the handoff into a separate frontend coding agent.
13.1 Summary contract diff table (mandatory)
Status	Method + exact /api/v1/... path	Role	Before	After	Breaking?	Frontend action
ADDED / CHANGED / UNCHANGED	...	ADMIN/CASHIER	Actual old body/query/response	Actual new body/query/response	YES/NO	Exact field or call to update


For every changed or added API, include these headings:
1. Purpose and role(s); branch-scoped vs business-wide.
2. HTTP method and full URL (including path param names).
3. Headers (Authorization, Idempotency-Key if required; cookies when relevant).
4. Query parameters: required vs optional, type, allowed values, defaults, and when missing gives 400.
5. Request JSON with required and optional fields; use valid test fixtures. If it changed, show BEFORE → AFTER JSON.
6. Success JSON response: exact envelope, data/`items` shape, totals, fields, pagination, enums, dates, null behavior; BEFORE → AFTER where changed.
7. Error status/response: 400/401/403/404/409 with sample messages for important validations.
8. Frontend action: page to update, selected business/branch source, variant ID behavior, caching/invalidation notes when relevant.
9. Migration/compatibility note: renamed enum, removed fallback, old legacy records, aliases/deprecations.
10. Verification evidence: test name or manual request/result, not invented.
13.2 Mandatory high-impact contracts to check for changes
- Admin requires businessId, and locationId for branch-scoped requests, including Orders, Catalog, Product/Variant stock, Shift, Expense/Payroll where appropriate, Reports, refunds and related APIs. List the exact request placement for EACH touched endpoint. No blanket "send IDs everywhere" without documenting exceptions.
- Cashier fixed scope: whether any request body fields must be omitted or are forbidden.
- POST /advances: no approval, no shift gate, no Expense posting; GET own vs Admin all; status and reversal semantics.
- Payroll POST /payroll/process, /payroll/disburse: no automatic advance deduction, paid amount, payment-method field if new, response and history/summary changes.
- Expenses GET, /summary, CRUD/PATCH, type=MANUAL/PAYROLL_NET, behavior of legacy SALARY_ADVANCE query, filtering and pagination.
- Orders catalog/custom/legacy payloads, price/tendered handling, negative stock, optional shift and idempotency header.
- Shifts cash estimate and cash-related response fields. Refund changes.
- Reports/data exports if figures, filter names or response fields change.
13.3 Sample format for ONE changed route (ILLUSTRATIVE ONLY)
GET /api/v1/expenses?businessId=B1&locationId=L2&type=PAYROLL_NET&category=SALARIES&month=11&year=2026
Authorization: Bearer <admin-token>
{
  "items": [
    {
      "id": "example-expense-id",
      "sourceType": "PAYROLL_NET",
      "type": "PAYROLL_NET",
      "category": "SALARIES",
      "amount": 20000,
      "businessId": "B1",
      "locationId": "L2",
      "payrollId": "example-payroll-id"
    }
  ],
  "totalCount": 1,
  "totalAmount": 20000
}
This JSON is a TARGET EXAMPLE, not certified existing output. Replace with actual response (including any standard envelope) before handing to frontend agent.

Final agent message MUST end with: Frontend contract changes: [N] endpoints; [full contract diff pasted above]; offline/PWA not implemented; source + DB test results listed accurately.
14. FINAL SIGN-OFF CHECKLIST FOR THE BACKEND AGENT
- [ ] Current repository/DTOs inspected; implementation not based on stale assumptions.
- [ ] Admin explicit IDs required in applicable routes; no missing-ID fallback; one-business Admin + multi-branch works.
- [ ] Cashier fixed business/branch; only own advance history; no payroll/expense access.
- [ ] Product/category/variant/stock CRUD and filters work; negative stock allowed and accurate; no accidental global fallback.
- [ ] Catalog/custom order/payment/refund flows correct; sale not gated by shift; stock and amount calculations atomic.
- [ ] Advance Ledger separate; no Expense auto-create; no payroll auto-deduct; no salary/shift/cash cap; historical branch recorded; cash deduction counted once.
- [ ] Admin payroll paid action produces ONE payroll Expense only, full paid salary without advance deduction; duplicate pay prevented.
- [ ] Admin Manual Expense CRUD; Expenses GET/summary only MANUAL + PAYROLL_NET, type/category filters reconcile, legacy advance expense rows excluded.
- [ ] Shift opening/closing and branch/day cash calculations correct, including unlinked events and cash/noncash distinction.
- [ ] Reports and audit events accurate; beneficial existing features preserved.
- [ ] Additive migrations tested (fresh + upgrade where feasible); code build, unit, PostgreSQL integration and role tests accurately reported.
- [ ] Complete copy-paste-ready frontend API handoff with every modified query/body/path/header/response contract.
- [ ] No frontend, PWA, offline implementation, new approval workflows, manager role, general ledger, unnecessary infrastructure rewrites.
Success definition: An understandable and maintainable online POS backend that executes normal store operations with predictable scoping and correct money/stock arithmetic. Ship validated functionality; handle later offline and advanced accounting improvements as separate projects.
