SunTech POS — ONLINE-ONLY Backend Source Audit
Snapshot: backend latest.zip (uploaded November 1, 2026)
References: docs/SunTech_POS_Current_Integrity_Finance_Agent_Playbook.md, docs/POS.md, source, DTOs, unit tests, Prisma schema and all bundled migrations.
Scope: NestJS/Prisma online authentication/authorization, businesses/branches, catalog, stock, checkout, shifts, refunds, advances, payroll, centralized expenses, reports, audit logs, data integrity, and maintainability.
Out of scope: PWA, offline clients, offline synchronization, offline retries/replay semantics, frontend implementation, unnecessary full-GL redesign. Do not fix/implement those for this release.
Evidence level: Source-code/static inspection only; actual PostgreSQL migrations, concurrency, full build, and HTTP E2E NOT RUN here. No claim of 100% bug-free or final sign-off. The ZIP intentionally omits .env, node_modules, .git, builds. That omission is not a bug.
Decision: NOT VERIFIED FOR PRODUCTION. First resolve release-blocking migration and reachable cash/stock/refund inconsistencies, then execute DB-backed online tests.
Executive summary
Implemented and worth retaining: No cashier/Admin approval is required for advances; PENDING denotes an advance already taken and awaiting payroll deduction. New advances create an automatic Expense of sourceType=SALARY_ADVANCE, category=SALARIES; disbursed payroll creates PAYROLL_NET for netPaid, and manual entries use MANUAL. GET /expenses and /expenses/summary can filter by independent type and category; expense deletion rejects salary-derived entries. Online /orders/catalog uses guarded branch stock subtraction; legacy /orders has guarded branch stock subtraction. SKU/product archive preserves historical rows, and zero branch stock is handled correctly in variant and category presentation. These are not new bugs.

Severity definitions: P0 = data corruption/money integrity/deploy blocker on reachable online path; P1 = serious correctness, reconciliation, or operational issue; P2 = contract, complexity, performance or policy inconsistency. A concurrency gap inferred from code needs PostgreSQL proof, but must not be certified safe without it.
P0 — Block launch or disable affected online operation
O01 · Broken Expense migration / schema drift — CONFIRMED P0

- Evidence: prisma/schema/pos.prisma:302-305 defines nullable unique advanceId and payrollId FKs. The initial migration creates Expense without those columns (prisma/schema/migrations/20261024000000_init/migration.sql:264-280). The latest migration adds sourceType, beneficiaryCashierId, paidAt but does not add advanceId/payrollId, then attempts FK creation against them (20261101140000_expense_source_type_and_projections/migration.sql:9-28). Also lacks their unique indexes.
- Impact: Fresh migration fails; upgrades lacking manually added columns fail. Prisma Client expecting those fields may also fail on a partially migrated database.
- Fix: Create the two nullable TEXT columns first, add unique indexes (@unique equivalents), add FKs after columns, check ON DELETE matches Prisma schema; test a clean database and cloned upgrade. For migration already recorded as applied on any DB, use a new corrective migration, not silently editing applied SQL. Never reset prod data.
- Test: prisma migrate deploy fresh + clone, verify indexes/FKs, read/write both source projections.
  O02 · Cashier advance may be paid without any cash register — CONFIRMED P0
- Evidence: src/hr/advance.service.ts:133-179 uses an optional activeShift and still writes both EmployeeAdvance and paid Expense when shiftId is undefined.
- Impact: The user's specified advance is physical cash taken from a register, but there may be no open register and no branch-verified cash source. Expense.paidAt still asserts money left.
- Fix: For the cash-register advance flow require the cashier's own OPEN shift in their assigned business and branch; check available cash using an authoritative shift balance; persist shift/branch and payout exactly once within the same transaction. This is NOT Admin approval and must not create an approval process. If insufficient funds, return 409/400 with clear reason. Do not permit a null shift for this specific flow.
- Test: No/open/closed/wrong-branch shift; 500 advance from 5,000 float; insufficient available drawer; retries.
  O03 · Voiding an already-paid advance fabricates a reversal — CONFIRMED P0
- Evidence: src/hr/advance.service.ts:200-242 soft-deletes any PENDING advance and its Expense projection with no cash-return condition. src/shifts/shift.service.ts:448-455 only counts advances where deletedAt=null.
- Impact: Cash already handed to the cashier disappears from the drawer outflow and admin spending view even without money being returned. For closed shifts the historical expected balance can disagree with the recorded count.
- Fix: Do not equate deleting the ledger record with reversing a physical payout. Require documented, confirmed cash returned into a specified drawer/account; perform a linked compensating reversal with actor, timestamp, reason, and amount. If no return, retain original outflow and use a non-reversing correction status. Prevent silently changing a closed shift's historical cash truth.
- Test: Void without return denied; actual return recorded exactly once; active/closed shift reconciliation preserved.
  O04 · Concurrent advance creation vs payroll settlement can miss/deduct wrong advances — SOURCE PROVES GAP, P0
- Evidence: src/hr/advance.service.ts:184-188 uses SERIALIZABLE, while src/hr/payroll.service.ts:63-65,121-135,297-407 uses default transaction isolation. Payroll aggregates pending advances then updateMany on a predicate which may include a newly inserted advance after the sum.
- Impact: totalAdvancesDeducted can differ from rows marked DEDUCTED, so net payroll paid and expense rows no longer reconcile. Advance creation also has no P2034 retry handling.
- Fix: Make advance vs payroll act on one consistent per-employee-per-month settlement lock/protocol with SERIALIZABLE + bounded P2034 retries, or an equivalent explicit DB lock. Verify the count and amount of the exact rows transitioned equal the captured total; use the same primitive for single and batch disbursement.
- Test: Two simultaneous advances, advance vs /payroll/process, advance vs /payroll/disburse, process vs batch; exactly one paid payroll/expense projection and correct deducted total.
  O05 · Manual stock mutations can overwrite concurrent sales/adjustments — SOURCE PROVES GAP, P0
- Evidence: src/catalog/variant.service.ts:522-546 reads current branch stock outside a transaction; lines 580-612 compute absolute targets; lines 613-668 commit upsert with stock: newLocationStock inside a default transaction. variant.service.ts:410-478 is a second stock-set path.
- Impact: Lost update when concurrent +N, set, sale or refund; global Variant.stock may diverge from sum of branch rows. Example: two simultaneous ADD 5 to stock 10 may finish at 15 instead of 20.
- Fix: One centralized stock-mutation function with inside-transaction read/guard, atomic increment/decrement when possible, serializable retry for absolute set, and global=sum(branch) reconciliation. Route both variant metadata PATCH and explicit stock endpoints through it; never suppress a required stock movement insert.
- Test: Concurrent add/add, add/sale, set/sale, refund/set across two branches; no lost quantity and exact movement history.
  O06 · Cash refund attributed to wrong/closed drawer — CONFIRMED P0
- Evidence: src/orders/refund.service.ts:242-266 prioritizes the original sale shift if OPEN, rather than the shift actually paying the refund; if no paying shift, payoutShiftId may be null. src/shifts/shift.service.ts:422-436 treats payoutShiftId:null as a refund from the original sale shift; admin dashboard has similar fallback at src/admin/admin-dashboard.service.ts:290-303.
- Impact: Money may leave drawer B but lower drawer A, or retrospectively affect a closed drawer. refund.service.ts:307-313 does not check whether conditional drawer update matched any row.
- Fix: For COD cash payouts require an explicitly selected or unambiguously resolved OPEN paying drawer belonging to actor's authorized branch. Store payoutShiftId and reject or reroute if it closes concurrently; never fall back to the sale shift. Distinguish digital refund/payment confirmation policy rather than treating all methods as drawer cash.
- Test: Yesterday's sale refunded from today's cashier drawer, different cashier same branch, no open drawer, shift closing concurrently, closed shift unchanged.
  O07 · Online idempotency success is separate from money/stock commit — CONFIRMED INTEGRITY GAP, P0
- Evidence: src/common/interceptors/idempotency.interceptor.ts:89-99,138-160,194-199,224-244. Business service can commit; storeSuccess() then separately updates replay row. On storage failure, releaseLock may delete the PENDING record and a retry can execute the money movement again. TTL is 24h even for sensitive paid operations.
- Impact: Lost HTTP response or idempotency persistence error can duplicate advance/manual expense/refund/stock mutation online. Unique payroll period prevents some payroll duplicates, not all financial actions.
- Fix: Bind durable operation identity to its source transaction (unique operationId or linked request row persisted with mutation); make successful replay recoverable after post-commit transport failure and after >24h. Preserve payload-hash conflict behavior, do not rely only on interceptor TTL. This applies to ONLINE requests independently of deferred offline work.
- Test: Force failure between DB commit and response-store; replay after 25h; same-key changed body; multiple concurrent requests; one source movement.
  O08 · Close shift races with live cash movements — SOURCE PROVES RISK, P0
- Evidence: src/shifts/shift.service.ts:307-366 closes with updateMany(status=OPEN) but sale, advance, refund services do not universally enforce the same lock/status transition in the transaction just before money writes. See src/orders/order.service.ts:393-428,650-659, src/hr/advance.service.ts:133-179, src/orders/refund.service.ts:242-313.
- Impact: Money can be attached to a shift while or after it closes, producing inaccurate expected cash and variance snapshots.
- Fix: Implement a shared drawer post/close concurrency protocol (row lock/conditional state update inside the posting transaction and serializable retry where required); shift close must include all committed movements or safely reject them. Do not manufacture physical cash-count results.
- Test: Order vs close, advance vs close, refund vs close; no post-close payout and deterministic balances.
  P1 — Must fix for trustworthy online operation and financial reporting
  O09 · Legacy Admin checkout silently picks a branch — CONFIRMED
- src/orders/order.service.ts:1503-1525: (dto as any).locationId is not in src/orders/dto/create-order.dto.ts:60-79, so the global whitelist strips it, then query falls back to the first branch. There is a separate fallback in checkoutWithin:1577-1579.
- Fix: Add validated locationId to legacy DTO, require explicit authorized location for ADMIN; remove implicit first branch. Keep cashier locked to assigned branch. Or disable legacy route after proving callers migrated; do not silently reroute orders.
  O10 · Variant edit writes wrong movement magnitude/direction — CONFIRMED
- src/catalog/variant.service.ts:410-478 uses Math.abs(dto.stock - current.stock) where current.stock is global stock, not previous target branch stock; direction is lost.
- Fix: Compute signed delta from targeted branch's transactional previous value; store correct adjustment type/direction and actor/reason. Share one stock mutation function (O05).
  O11 · Product inventory summary returns global stock for empty branch — CONFIRMED
- src/catalog/product.service.ts:339-347: when effectiveLocationId is set but v.locationStocks has no rows, leaves stock = v.stock (global). VariantService.presentVariant and CategoryService.list correctly return zero when the requested branch has no row.
- Fix: Unconditionally resolve branch stock by matching row or zero when locationId is present. Add cross-endpoint parity test for global 12, branch A=12, branch B no row=0.
  O12 · Payroll Expense marks employee as the posting actor — CONFIRMED
- src/hr/payroll.service.ts:152-169,378-395 puts userId: cashier.id/staff.id, although the ADMIN triggers disbursement. beneficiaryCashierId already captures employee. Historical Who Paid/Who Recorded metadata is wrong.
- Fix: Pass authenticated admin sub into shared settlement function; set userId=admin.sub, retain beneficiary separately. Avoid changing historical records without audited migration.
  O13 · Historical branch attribution changes when staff transfers — CONFIRMED
- No locationId snapshot on EmployeeAdvance/`PayrollRecord` in prisma/schema/hr.prisma:16-62; src/hr/advance.service.ts:278-283,308-328 and src/hr/payroll.service.ts:199-223,421-430 filter/report using cashier's current location.
- Fix: Record historical branch on each new advance/payroll; for cash-register advances source it from the paying shift; for payroll snapshot actual disbursing branch/account. Read by that snapshot, not employee's current assignment. Keep old rows as unknown until verified, avoid invented backfill.
  O14 · Payroll 'process' and 'disburse' both mark PAID without confirmed funding/payment — CONFIRMED SEMANTIC GAP
- src/hr/payroll.service.ts:138-169,364-395 creates PAID and paid expense immediately on invoking either endpoint; no payment channel/funding account/confirmation reference, no explicit paidAt on PayrollRecord (schema hr:41-62). This matches immediate settlement only if calling these endpoints means the admin actually paid.
- Fix: Clarify API naming/contract: process must mean execute disbursement, never preview; summary is preview. Capture actual payment event/time/method/source and enforce exactly once. No Admin approval workflow is needed. If Admin calls endpoint after paying cash, record that source truth; do not invent bank settlement.
  O15 · Payroll summaries omit previously paid staff who became inactive/deleted/moved — CONFIRMED
- src/hr/payroll.service.ts:181-260 maps only current non-deleted cashiers with a salary configured even though paid records are queried independently. Historical PAID payroll may vanish from summary on staff deletion or role/salary changes, while location filtering follows current branch.
- Fix: Union PAID records with eligible unpaid staff; preserve past snapshots and explicit payout state. Paid historical totals must remain visible regardless of today's staff roster.
  O16 · Advances may be stranded by salary reduction or cashier deletion — SOURCE-DERIVED RISK
- src/users/user.service.ts:247-250 permits lowering salary without comparing already-paid pending advances; src/hr/payroll.service.ts:128-130 then refuses to disburse if pending advances exceed current salary. src/users/user.service.ts:321-372 soft-deletes cashiers, while payroll selects only deletedAt:null.
- Fix: Decide policy for salary revisions/terminated cashiers. Prevent inadvertently unreconcilable future payroll, preserve paid advances and allow an explicit supported final-settlement/correction workflow. Do not impose an unapproved salary approval queue.
  O17 · Expense/advance GET reads are unbounded — CONFIRMED
- src/expenses/expense.service.ts:200-275,323-349 fetches all matching records and groups them in JS; src/hr/advance.service.ts:295-360 also returns an unpaginated ledger; several payroll reports load entire periods.
- Fix: Add backward-compatible pagination to main listing, return total DB aggregate separately, compute byCategory/byType in database, index common filters; avoid changing existing front-end contract abruptly. Keeping detailed summary items optional/paginated is fine.
  O18 · Dashboard 'netCashflowToday' is not verified cashflow — CONFIRMED
- src/admin/admin-dashboard.service.ts:262-263 computes net sales minus all incurred expenses, mixing digital/card/cash sales, paid advances, payroll, and manual expenses with no funding confirmation. The active shift figure is also one selected drawer, not necessarily all drawers in branch (:266-334).
- Fix: Relabel/deprecate as provisional net sales minus recorded spending or calculate distinct cash/payment-source KPIs. Do not present it as reconciled drawer/bank cash. Avoid double count of salary projections when adding payroll cost accounting later.
  O19 · Finance operations are largely missing audit entries — CONFIRMED
- rg auditLog.create finds checkout low-stock events and AuditService.log only for staff changes; no audit log creation in src/hr/advance.service.ts, src/hr/payroll.service.ts, src/expenses/expense.service.ts, src/orders/refund.service.ts.
- Fix: Record who/what/business/branch/source/amount/before-after for creation, payout, void, payroll and refund inside the same DB transaction as financial mutation (or durable event/outbox). Never store sensitive secrets. This supports the Audit Logs UI without changing frontend.
  O20 · Cash sales can exist with no open shift; register metrics omit them — CONFIRMED
- src/orders/order.service.ts:393-428,650-659,1582-1592 allows shiftId=null while an online COD sale is marked PAID; shift metrics calculate only orders with a shift ID.
- Fix: If COD represents physical register money, require cashier's OPEN shift for that flow (Admin can use an explicit different authorized cashier/drawer or defined off-register payment channel). If intentionally permitted, classify as UNASSIGNED_CASH_SALE rather than claiming complete shift reconciliation. Preserve noncash sales behavior.
  O21 · Reports mix refund event dates with order dates — CONFIRMED
- src/reports/report.service.ts:798-824 subtracts refund totals using where: { order: where }, not refund creation/payout date; some payment breakdowns also subtract refunds on the original order's reporting period (:531-539).
- Fix: Define distinct order-period net revenue and payment-period cashflow; when reporting monthly cash movements use Refund.createdAt (or confirmed payout timestamp) in that period, with correct account/branch. A November refund against an October sale must not move November cash to October.
  O22 · variantRevenue ignores refunds — CONFIRMED
- src/reports/report.service.ts:827-867 groups orderLine subtotals/quantities with no refund adjustment. src/catalog/category.service.ts:203-245,282-289 similarly groups PAID lines but does not subtract partial refunds.
- Fix: Either label as GROSS before refunds, or compute net revenue/units consistently from RefundItems, with a documented period policy.
  P2 — API gaps, unnecessary complexity, validation and cleanup
  O23 · Manual Expenses is not full CRUD — CONFIRMED CONTRACT GAP
- src/expenses/expense.controller.ts exposes POST, GET, GET summary, DELETE; there is no PATCH/PUT. If owner means actual Expenses CRUD, add PATCH /expenses/:id only for MANUAL rows with tenant scope, validation and audit; do not allow edits to generated salary projections.
  O24 · Product creation doesn't enforce at least one variant — CONFIRMED REQUIREMENT GAP
- src/catalog/product.service.ts:169-218 persists Product without nested variants; src/catalog/dto/create-product.dto.ts has no variants array. Prior owner requirement: each product must have >=1 variant and creation must include one. Either explicitly support draft products and keep them unsellable, or implement atomic create-with-variants while preserving old API compatibility.
  O25 · Stock-type derived from free-text notes — CONFIRMED UNWANTED FLOW
- src/catalog/variant.service.ts:580-583 treats a manual DEDUCT as SALE if note contains sale (e.g., wholesale adjustment), corrupting transaction classification. Use explicit immutable source type from operation, not substring. Also avoid silently accepting multiple competing stock, quantity, delta inputs in src/catalog/dto/update-variant-stock.dto.ts/service, and decide whether negative stock should be allowed at all for Admin.
  O26 · Mock-compatibility branches in production services — CONFIRMED COMPLEXITY
- Widespread tx.expense?.create, tx.employeeAdvance?.aggregate, this.prisma.$transaction ? ... : ..., as any in src/hr/advance.service.ts, src/hr/payroll.service.ts, src/catalog/variant.service.ts, src/shifts/shift.service.ts, etc. The real typed Prisma client has these delegates/methods; silent ?. can skip a mandatory expense/ledger write in unusual test/configuration conditions while reporting success.
- Fix: Use typed Prisma.TransactionClient, make required writes mandatory, simplify logic and update mocks/tests; avoid large unrelated refactors. Consolidate duplicated single/batch payroll posting in one shared function and the multiple stock mutation paths in one primitive.
  O27 · Manual expense 'spent' does not equal 'paid' — CONFIRMED SEMANTIC GAP, OWNER DECISION
- src/expenses/expense.service.ts:116-130 records spentAt but leaves paidAt unset; summary includes all MANUAL rows. For requested business spending this is fine if meaning is incurred/recorded expenses, but NOT proof of paid cash outflow. Keep category separate from sourceType and expose payment basis when needed; don't force bank/cash workflow if owner wants manual entry only.
  O28 · Test suite doesn't verify actual financial concurrency/migrations — CONFIRMED VERIFICATION GAP
- HR and expense service tests are largely mocked (e.g. src/hr/payroll.service.spec.ts); bundled test/app.e2e-spec.ts is smoke-level. No included PostgreSQL integration tests prove fresh migration, exact-once money or drawer races.
- Fix: Add DB-backed E2E/concurrency tests for O01–O08, HTTP tenant isolation, and three-source expense totals before claiming clean release. Do not request node_modules, .env, or .git uploads; install/configure only inside the agent's testing environment.
  Business contract to preserve — NO approval stage
- POST /api/v1/advances by CASHIER: immediately takes cash from that cashier's verified open cash register, inserts EmployeeAdvance already granted with PENDING=not-yet-deducted, creates exactly one linked Expense(sourceType=SALARY_ADVANCE,category=SALARIES) and reduces that drawer's expected cash. No Admin approval or approval status.
- GET /api/v1/advances: advance ledger records; cashier only own, Admin business-wide.
- POST /api/v1/payroll/process or /disburse by ADMIN: actual payout, deduct previously granted current-period advances, create paid PayrollRecord + exactly one PAYROLL_NET Expense of net cash paid; no extra approval flow. Ensure process is never used merely for calculation.
- Manual POST /api/v1/expenses: create MANUAL expense; manual CRUD is restricted to manual entries.
- GET /api/v1/expenses / /summary: all three types included by default, filter independently by type/`category`, business/branch correct. Example: 5,000 advance + 15,000 net payroll + 2,000 manual = 22,000 recorded outflows (not three separate payroll accruals).
- Soft deletion of a salary source must not erase cash that was actually paid. Keep source identity and verifiable reversal.
- Keep all currency amounts integer BDT. Do not introduce a salary approval flow.
  Release execution order (minimum patches; avoid rewriting working modules)

1. Schema gate: O01, fresh/upgrade SQL; reconcile Prisma schema/client. Stop deployment if broken.
2. Money/shift gate: O02, O03, O06, O08, O20, O07. Establish real register funding, payout/repayment and durable online idempotency. Do not build new general ledger solely to satisfy an online client demo.
3. Payroll gate: O04, O12–O16, salary projections exactly once. Coordinate process/disburse; preserve previous working no-approval/type/category behavior.
4. Stock and checkout gate: O05, O09–O11, O25; prove online catalog + legacy path + manual adjustments under concurrency.
5. Trustworthy reporting/UI API: O17–O19, O21–O23, O27; keep compatibility, add precise semantics, financial audit logs.
6. Cleanup: O24, O26, O28. Remove fallbacks only in touched modules and update tests. Keep expensive new capabilities deferred if not critical to release.
   Online-only verification matrix (real PostgreSQL)
   Test Expected
   Fresh schema migration Runs without missing Expense.advanceId/payrollId, indexes and FKs exist
   Existing DB upgrade Additive, preserves historical Expense/Advance/Payroll rows
   Cashier advance no open drawer Rejected; nothing posted
   Cashier 500 advance on OPEN drawer One Advance + one SALARY_ADVANCE Expense; expected cash −500; no approval
   Advance with insufficient drawer funds Rejected, no partial writes
   Void paid advance without repayment No disappearing cash; denied or explicit non-cash correction
   Cash return recorded One linked reversal, source/projection and drawer balance consistent
   Concurrent advance vs payroll All paid advances either included or request deterministically fails/retries; sum matches deducted set
   Payroll base 20k, advance 5k Net paid 15k Expense; SALARIES cash paid total 20k, no double count
   Manual expense 2k Type MANUAL, appears together with 5k advance + 15k payroll = 22k
   Expenses filter Both independent type and category filters produce consistent rows+summary
   Refund yesterday sale today from current drawer Current drawer debited; old drawer unchanged
   Close vs money movements No post-close paid entries; count/variance not fabricated
   2 concurrent terminals sell last 1 stock Exactly 1 accepted, 1 rejected safely
   Concurrent branch stock adjustment No lost updates; global stock = sum(branch)
   Admin legacy checkout multi-branch Uses explicit validated authorized branch, no first-branch fallback
   Product/category/variant summaries branch B with no stock row All show 0, not business-global stock
   Lost response after successful financial write Retry does not re-debit money / reinsert Expense
   Staff transfer or salary change after paid payroll Historical branch, employee and payment totals stable
   Financial audit logs Every material create/reversal/disbursement/refund has actor, time, branch and source

Minimal coding-agent execution prompt
Read docs/SunTech_POS_Current_Integrity_Finance_Agent_Playbook.md, then the online-only audit. Validate each cited finding against current code, do NOT assume previous notes are still true if source changed. Implement P0 fixes first, preserving the existing advances / payroll / manual expenses GET filters and no-approval behavior. Do not implement offline/PWA or change /orders/sync; do not force a new general ledger if not necessary to the approved MVP. Repair migrations with additive SQL and never reset production DB. Fix online financial idempotency, exact drawer sourcing, refund attribution, advance reversals, payroll concurrency, and stock/legacy checkout. Avoid unnecessary validations, extra approval workflows and unrequested modules. Then fix P1 contract/reporting issues. Run actual fresh+upgrade PostgreSQL migrations, build, unit/E2E and concurrent integration tests. Report precisely what was run and PASS/FAIL; refuse production sign-off if P0 unresolved. Do not ask for node_modules, .env, .git or generated folders.

Limits
This is an evidence-based static audit of the included snapshot, not a literal execution trace of every code branch. For an actual no-bug release certification, run tests and inspect production deployment schema, controlled test database and networked service behavior. Audit classifications may change after reproduction; do not mistake a P0 risk for a proved production incident, nor a mock-unit pass for an E2E pass. No offline-specific issue is a blocker in this report.
