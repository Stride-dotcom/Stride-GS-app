# Build Plan — Optimistic Updates + Payments Supabase Mirror

**Created:** 2026-04-16 (session 68)
**Status:** Planned — not started
**Estimated effort:** 4-6 hours total (Phase 1 = 2-3h, Phase 2 = 2-3h)

---

## Context

Session 68 shipped server-side batch endpoints that eliminate tab-close partial-completion risk across 9 bulk action buttons. The batches are now correct and safe, but user-perceived speed still has a visible 2-8s loading state for every bulk action because:

1. **UI waits for the server round-trip** before rendering any change. Even a single-call batch endpoint takes 2-4s for the GAS handler to loop + flush + write-through.
2. **Payments page is the only remaining list view still on full GAS** (2-5s per tab switch). All other entities already have Supabase read cache.

Goal: make bulk actions feel instant (<100ms perceived), and close the last remaining Supabase cache gap.

---

## Phase 1: Optimistic Updates for Bulk Actions

### What "optimistic" means here

Pattern already proven on single-row actions (Tasks/Repairs/WillCalls — see `applyTaskPatch` / `mergeTaskPatch` / `addOptimisticTask` machinery in `useTasks.ts`, etc.):

1. User clicks bulk action → immediately patch all affected rows in-memory (UI flips to new state <50ms)
2. Fire the batch API call in background
3. On response: clear patches, real server data takes over
4. If any row failed: revert just those rows + show the failure in the result modal

### Surfaces to upgrade

| # | Bulk action | Page | Existing single-row patch hook | Patch field(s) to set | Revert logic |
|---|---|---|---|---|---|
| 1 | Bulk Cancel Tasks | Tasks.tsx | `applyTaskPatch` | `status: 'Cancelled'` | Server `errors[].id` → clear that task's patch |
| 2 | Bulk Cancel Repairs | Repairs.tsx | `applyRepairPatch` | `status: 'Cancelled'` | Same |
| 3 | Bulk Cancel Will Calls | WillCalls.tsx | `applyWcPatch` (exists) | `status: 'Cancelled'` | Same |
| 4 | Bulk Reassign Tasks | Tasks.tsx | `applyTaskPatch` | `assignedTo: newValue` | Same |
| 5 | Bulk Schedule Will Calls ✨ | WillCalls.tsx | `applyWcPatch` | `estimatedPickupDate + status: 'Scheduled'` | Same |
| 6 | Bulk Release Will Calls | WillCalls.tsx | `applyWcPatch` | `status: 'Released'` (or 'Partial') | Same |
| 7 | Bulk Send Quote | Repairs.tsx | `applyRepairPatch` | `status: 'Quote Sent' + quoteAmount` | Same |
| 8 | Request Repair Quote (bulk) ✨ | Inventory.tsx | (need) `addOptimisticRepair` per item | Add optimistic repair rows | Remove optimistic rows for errors |
| 9 | Bulk Void Stax Invoices ✨ | Payments.tsx | (need new) `applyStaxInvoicePatch` | `status: 'VOIDED'` | Same pattern |
| 10 | Bulk Delete Stax Invoices ✨ | Payments.tsx | (need new) | `status: 'DELETED'` | Same |
| 11 | Bulk Charge Invoices (real money) | Payments.tsx | (need new) | **Intentionally NOT optimistic** — real money, need server confirmation before flipping row to PAID |
| 12 | Create Invoices bulk | Billing.tsx | (need new) `removeOptimisticUnbilledRow` | Remove row from Unbilled Report; show spinner on the invoice card | Re-add row if it failed |

✨ = new since session 68; patch hook needs to be added.

### Missing patch infrastructure to add

`useStaxInvoices` doesn't exist as a data hook (Payments.tsx does its own direct fetches). Two options:

- **Option A (quick):** add local `[patchMap, setPatchMap]` state in Payments.tsx. Merge patches into the displayed invoice list via `useMemo`. Expires after 120s (auto-clear in `useEffect`).
- **Option B (clean):** create `useStaxInvoices` hook + `applyStaxInvoicePatch` / `mergeStaxInvoicePatch` matching the existing patch machinery. Then Phase 2's Supabase mirror fits in cleanly.

**Recommended: B** since we're doing Payments Supabase mirror next. Pays for itself.

For `Inventory.tsx` Request Repair Quote — optimistically push a row into `repairs` via `addOptimisticRepair` (already exists on `useRepairs`). Since the user just triggered "create new repair", the new `repairId` isn't known until server returns — use temp IDs like `REPAIR-TEMP-{itemId}-{ts}` and reconcile on response.

For `Billing.tsx` Create Invoices — the inverse of creating: optimistically REMOVE unbilled rows from the Unbilled Report. On failure (server returned `success: false` for a group), re-add them. Pattern: `setHiddenUnbilledIds` state; UI filter hides those rows until clear.

### Result modal UX

After the batch completes, the `<BulkResultSummary>` modal already renders with per-row outcomes. Two upgrades needed:

1. **Keep the summary on screen** even if all rows succeed (currently auto-dismisses some places). The summary IS the evidence that the operation worked — optimistic rows already moved in the UI.
2. **Per-row revert on failure:** when `result.errors[].id` is non-empty, the component shows a red-highlighted row for each failure AND the background patch for that row gets cleared — so the user sees both the modal entry AND the UI row snapping back to its old value.

### Shared utility to add

New helper `src/lib/optimisticBulk.ts`:

```ts
export function applyBulkPatch<T>(
  ids: string[],
  patchFn: (id: string, patch: Partial<T>) => void,
  patch: Partial<T>
) {
  for (const id of ids) patchFn(id, patch);
}

export function revertBulkPatchForFailures<T>(
  errors: Array<{ id: string }>,
  clearFn: (id: string) => void
) {
  for (const e of errors) clearFn(e.id);
}
```

Reusable across all 11 call sites. Drop-in — no new patterns.

### Failure-case handling for real-money Bulk Charge

Bulk Charge intentionally stays non-optimistic:
- UI shows `<BatchProgress>` overlay with live progress ticker (already done in session 68)
- Each row only flips to PAID after server confirms charge succeeded
- Rows that fail flip to CHARGE_FAILED with Stax error visible
- Never show "PAID" speculatively — that would mislead an admin watching a charge run

This is a deliberate exception, documented in the code as a comment.

### Phase 1 Files to Modify

| File | Change |
|---|---|
| `src/lib/optimisticBulk.ts` | New — reusable `applyBulkPatch` + `revertBulkPatchForFailures` |
| `src/hooks/useStaxInvoices.ts` | New — Supabase-first (Phase 2) + patch machinery |
| `src/hooks/useBilling.ts` | Add `addOptimisticHiddenUnbilled(ids)` / `revealUnbilled(ids)` |
| `src/pages/Tasks.tsx` | Wrap `handleBulkCancelTasks` + `handleBulkReassign` with optimistic flow |
| `src/pages/Repairs.tsx` | Wrap `handleBulkCancelRepairs` + `handleBulkSendQuote` |
| `src/pages/WillCalls.tsx` | Wrap `handleBulkCancel/Schedule/Release` |
| `src/pages/Inventory.tsx` | Wrap `handleBulkRequestRepairQuote` with `addOptimisticRepair` |
| `src/pages/Payments.tsx` | Switch to `useStaxInvoices`, wrap Bulk Void/Delete optimistically (NOT Bulk Charge) |
| `src/pages/Billing.tsx` | Wrap Create Invoices — optimistically hide unbilled rows |
| `src/components/shared/BulkResultSummary.tsx` | Visual "reverted" indicator per failed row |

### Phase 1 verify

1. `npm run build` clean
2. Bulk cancel 3 tasks → rows flip to Cancelled instantly → confirm spinner/overlay briefly → modal shows 3/3 success → no visible shift
3. Simulate failure (disconnect network mid-batch) → reverted rows snap back to Open → modal shows errors[] entries
4. Bulk Charge still feels the same as session 68 (progress ticker, no premature PAID flip)
5. Create Invoices: 5 unbilled groups → all 5 disappear from report immediately → invoice cards appear → any failures re-add rows

---

## Phase 2: Payments Supabase Mirror

Payments is the last major list view without a Supabase cache. Per-tab loads hit GAS:
- Stax Invoices list (2-4s per switch)
- Charge Log (3-5s, grows with volume)
- Exceptions (2-3s)
- Customers (2-3s)
- Run Log (2-4s)

Phase 1's `useStaxInvoices` hook lays the foundation — add Supabase-first behind it.

### Tables to mirror

| Supabase table | Source sheet (Stax spreadsheet) | Unique key | Write volume |
|---|---|---|---|
| `stax_invoices` | Invoices tab | `qb_invoice_no` | High during daily autopay runs |
| `stax_charges` | Charge_Log tab | surrogate `id` bigserial (append-only) | High during autopay runs |
| `stax_exceptions` | Exceptions tab | surrogate `id` bigserial (append-only) | Medium |
| `stax_customers` | StaxCustomers tab | `stax_customer_id` | Low (admin edits) |
| `stax_run_log` | RunLog tab | surrogate `id` bigserial (append-only) | One row per autopay run |

All 5 are admin-only (RLS: `role IN ('admin', 'staff')`), no tenant partitioning needed — Payments is an internal tool.

### Write-through strategy

StaxAutoPay.gs runs the autopay pipeline and mutates multiple sheets per charge. Session-68 StrideAPI.gs already has `supabaseUpsert_` + `supabaseBatchUpsert_` available. Strategy:

- **High-frequency writes (charges + invoices):** batch upsert at end of each autopay run (not per-row) to stay under the 6-min Apps Script limit
- **Append-only logs:** batch insert per run
- **Low-frequency (customers, manual single-invoice changes):** per-row resync

Mutation paths that need write-through:
| GAS Handler | What it writes | Write-through |
|---|---|---|
| StaxAutoPay.`executeChargeRun_` | Invoices (status → PAID/CHARGE_FAILED), Charge_Log (append), RunLog (append) | Batch upsert invoices + batch insert logs at end |
| StaxAutoPay.`prepareEligiblePending_` | Invoices (status → CREATED, Stax ID, customer ID) | Batch upsert at end |
| StrideAPI.`handleVoidStaxInvoice_` | Invoices (status → VOIDED) | Per-row upsert |
| StrideAPI.`handleDeleteStaxInvoice_` | Invoices (status → DELETED) | Per-row upsert |
| StrideAPI.`handleBatchVoidStaxInvoices_` ✨ | Invoices (status → VOIDED in bulk) | Batch upsert at end |
| StrideAPI.`handleBatchDeleteStaxInvoices_` ✨ | Invoices (status → DELETED in bulk) | Batch upsert at end |
| StrideAPI.`handleChargeSingleInvoice_` | Invoice (status), Charge_Log (append) | Per-row + per-log |
| StrideAPI.`handleCreateStaxInvoices_` | Invoices (push to Stax → status=CREATED) | Batch upsert |
| StrideAPI.`handleCreateTestInvoice_` | Invoices (new row) | Single upsert |
| StrideAPI.`handleImportIIFFromDrive_` | Invoices (batch new rows) | Batch upsert at end |
| StrideAPI.`handleToggleAutoCharge_` | Invoices (Auto Charge column) | Batch upsert of affected rows |
| StrideAPI.`handleUpsertStaxCustomer_` | StaxCustomers (add/edit row) | Single upsert |

### Migration files

1. `20260416120000_stax_invoices_cache_table.sql`
2. `20260416120001_stax_charges_exceptions_customers_runlog_cache.sql`

Follow existing RLS pattern (`service_role all`, admin/staff SELECT, REPLICA IDENTITY FULL for realtime).

### React refactor

`Payments.tsx` currently does raw `fetchStaxInvoices` / `fetchStaxChargeLog` / etc. inside `loadData()`. Replace with:
- `useStaxInvoices()` — Supabase-first
- `useStaxCharges()` — Supabase-first
- `useStaxExceptions()` — Supabase-first
- `useStaxCustomers()` — Supabase-first
- `useStaxRunLog()` — Supabase-first

All follow the 6-existing-hook template (Supabase → GAS fallback). Drop `loadData()` and use hook refetch.

### Seed functions (one-time, per table)

New helpers in StrideAPI.gs:
- `seedStaxInvoicesToSupabase()`
- `seedStaxChargesToSupabase()`
- `seedStaxExceptionsToSupabase()`
- `seedStaxCustomersToSupabase()`
- `seedStaxRunLogToSupabase()`

Or one combined `seedAllStaxToSupabase()`. Bug-for-bug same as marketing seeds.

### Phase 2 Files to Modify

| File | Change |
|---|---|
| 2 new migration SQL files | `supabase/migrations/20260416120000_*.sql` |
| `src/lib/supabaseQueries.ts` | 5 new `fetchXxxFromSupabase` functions |
| `src/hooks/useStaxInvoices.ts` | New (built in Phase 1, Supabase-first added here) |
| `src/hooks/useStaxCharges.ts`, `useStaxExceptions.ts`, `useStaxCustomers.ts`, `useStaxRunLog.ts` | New |
| `src/pages/Payments.tsx` | Drop `loadData`, use 5 hooks |
| `AppScripts/stride-api/StrideAPI.gs` | `sbStaxInvoiceRow_`, `resyncStaxInvoiceToSupabase_`, write-through in 7 mutation handlers, 5 seed functions |
| `AppScripts/stax-auto-pay/StaxAutoPay.gs` | Batch upsert at end of `executeChargeRun_` and `prepareEligiblePending_`; append-only batch insert for Charge_Log / RunLog |

### Phase 2 verify

1. Apply migrations; confirm tables created
2. Run seeds once; confirm row counts match sheets
3. Load Payments page → each tab loads in ~50ms
4. Trigger a single charge → invoice row flips to PAID in UI after confirmation (not optimistic — real money) AND Supabase row is upserted
5. Run autopay charge run (or simulate) → batch upsert of all charged invoices hits Supabase within 1s of run end
6. Void an invoice → row changes status instantly (Phase 1 optimistic) → Supabase upserted
7. Inspect `stax_invoices` in Supabase dashboard → row counts match sheet

### Caveats

- **`stax_charges` is append-only** — the `handleResetStaxInvoiceStatus_` handler currently DELETES charge log rows if user chooses "also delete logs". Need parallel DELETE from Supabase via `?qb_invoice_no=eq.X&status=eq.FAILED` REST filter. Not hard, but watch out.
- **Realtime isn't needed** for Payments — admin-only page, no cross-tab collaboration expected. Skip the Supabase realtime subscription in hooks for now.
- **Stax customer verification panel** uses a live Stax API call (not sheet-based). That stays GAS — it's not a list view.

### Out of scope for this plan

- Charge Log deep linking (separate feature)
- Stax webhook ingest → direct Supabase write (would bypass sheet entirely, major arch shift — waiting for full WMS app)
- Payments page dashboard cards (already computed from the same data, will benefit automatically from the hooks)

---

## Combined Verification (end of Phase 2)

1. Open Dev Tools → Network. Load Payments page cold (incognito). Confirm all 5 tabs fetch in <500ms total.
2. Bulk Void 5 invoices → rows flip to VOIDED instantly (Phase 1) → server confirms → Supabase upserted (Phase 2) → no flash.
3. Bulk Cancel 10 Tasks on Tasks page → rows flip to Cancelled instantly → modal shows "10 succeeded" → no server round-trip visible to user.
4. Simulate a network failure on Bulk Send Quote for 1 of 5 repairs → 4 stay Quote Sent, 1 snaps back, modal shows 1 error row.
5. Close tab mid-Bulk Charge → previous session 68 behavior preserved: server-side `handleChargeSingleInvoice_` calls have either completed or not, no UI orphaning; the in-flight charge finishes on server.

---

## Ordering

Can do Phase 1 alone (2-3h) — immediate UX win, no schema changes.
Phase 2 depends on Phase 1's `useStaxInvoices` hook scaffold, but only that one hook; the rest of Phase 2 is additive.

Recommended: Phase 1 in one sitting, Phase 2 in the next session.
