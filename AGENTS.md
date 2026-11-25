# SunTech backend: local-first checkout rules

Read `docs/OFFLINE_PHASES_1_7_BACKEND.md` before changing offline permission, order creation, synchronization, recovery, stock, money or receipt handling. In the combined delivery, also read `../frontend/docs/offline/SUNTECH_POS_PWA_OFFLINE_MASTER_SDD.md`.

## Preserve the existing business

- Keep legacy routes and DTOs compatible. New local-first purchases use `/orders/sync-v2`; old unresolved HTTP requests stay on their original protocol and key.
- A purchase keeps the same original user, device, business, branch, event time and UUID across every retry and restore.
- Preserve real catalog variant IDs, whole BDT, manual COD/BKASH/NAGAD/BANK, optional shifts and permitted negative stock.
- Never infer captured-price permission from `clientOrderId`. Use the explicit signed policy.
- Save order, stock, drawer cash, original official receipt, warning evidence and permanent identity in the same database transaction.
- `100` is a per-request batch size. Never introduce a maximum number of saved offline sales.
- Do not delete unknown, pending or completed financial identity evidence on a timeout, logout, expiry, rollback or database cleanup.
- Do not silently reattribute an absent cashier's events to the current manager.
- Payroll/advance/refund/Admin offline writes need their own protocols. Do not put them in the sale queue.

## Verification

Run the full regression suite, compile the backend, and use `node scripts/test-local-first-db.cjs` for real disposable PostgreSQL cases. This script never reads a production database URL. Do not package generated test database directories, credentials, `node_modules`, or build output.

For a financial change, record the old behavior, change, exact bug/edge case, test evidence, any remaining policy decision, and rollback behavior. Local test success is not approval to deploy or choose the store's offline permission lifetime or backup custodian.

## Current continuation: advanced staging checkpoint

Read section 30 of the current master SDD and the combined root `PHASES_8_12_STAGING_REPORT.md` before changing refunds, advanced commands, accounting, backups or rollout. Phase 8–12 are NOT complete. New advanced capabilities default off; do not enable real payouts or silently choose accounting/recovery policy. Preserve all original IDs, scopes, v3 IndexedDB data, v2 backups and command receipts. The focused test adapter is not live database or browser qualification. Regenerate the PWA assets and pass the complete release gates before enabling advanced intake.


## Latest flow-preserving hardening checkpoint

Read master SDD section 31 and `../FLOW_PRESERVING_HARDENING_REPORT.md` first. Keep normal online refund atomic receipt behavior on the same legacy HTTP endpoint and key. Do not re-open an old pending receipt, delete financial evidence, or transfer a sale/refund to a different protocol after timeout. Do not enable the remaining Phase 8–12 financial/Admin features by inventing temporary identities or accounting/recovery policy. All 25 pages and existing route contracts are preserved. The 70 passing focused tests are not full release qualification; the full builds, real HTTP/DB and device checks must pass.
