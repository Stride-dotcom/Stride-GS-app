# AUDIT — Billing handler SB-readiness (2026-06-01)

> Goal: kill GAS for the billing critical path. createInvoice is the #1 highest-traffic GAS handler (128 calls/week). This audit checks SB readiness for the 10 billing handlers the user listed and stages the work to flip them.

**Worktree:** `C:\dev\stride-billing-audit` (branch `chore/audit/billing-sb-readiness`, off `origin/source` at `7fe9657e`).
**Audited by:** parallel Explore agents against current source.
**Reference:** [MIGRATION_STATUS.md](stride-gs-app/MIGRATION_STATUS.md) (MIG-005, MIG-007, MIG-010, MIG-013), [BUILD_STATUS.md](stride-gs-app/BUILD_STATUS.md) "Open billing-system hardening backlog".

---

## TL;DR

| Handler | EF lines | Routing status | Business-logic gaps | Readiness |
|---|---|---|---|---|
| `createInvoice` | 434 | Direct ✓ | **Missing `invoice_tracking` INSERT** (HIGH) | needs-fix |
| `voidInvoice` | 250 | Direct ✓ | SB-first per PR #552; clean | **READY** |
| `reissueInvoice` | 250 | Direct ✓ | Missing pre-commit Unbilled re-check (2026-05-05 landmine); missing `storage_billing_items` reset | needs-fix |
| `syncClientBilling` | 95 | **Hyrel bug → routes to billing-extras-sb** | Bridge to GAS; OK as transitional | router-fix |
| `updateBillingRow` | 160 | Direct ✓ | Faithful mirror | **READY** |
| `generateUnbilledReport` | 288 | Direct ✓ | Read-only; minor `tenantId` vs `sourceSheetId` in payload | **READY** |
| `commitStorageRows` | 281 | **Hyrel bug → routes to billing-extras-sb** | Substantive impl | router-fix |
| `addManualCharge` | 150 | Direct ✓ | Missing `reference: ''` in insert (cosmetic) | **READY** (1-line) |
| `voidManualCharge` | 116 | Direct ✓ | SB richer than GAS | **READY** |
| `voidUnbilledRows` | 128 | **Hyrel bug → routes to billing-extras-sb** | Missing `storage_billing_items` flip (also missing in GAS) | router-fix |

**Bottom line:** 4 ready now, 3 fixable in this PR (router + small tweaks), 3 need design work before flipping.

---

## 1 — Critical finding: the apiRouter Hyrel bug

[`src/lib/apiRouter.ts`](stride-gs-app/src/lib/apiRouter.ts#L134-L138) keeps three billing actions in `GROUPED_BILLING_EXTRAS`:

```ts
const GROUPED_BILLING_EXTRAS = [
  'markBillingActivityResolved', 'resendInvoiceEmail',
  'previewStorageCharges', 'commitStorageRows', 'syncClientBilling',
  'voidUnbilledRows',
] as const;
```

Direct entries also exist for the same three actions (lines [231](stride-gs-app/src/lib/apiRouter.ts#L231), [284](stride-gs-app/src/lib/apiRouter.ts#L284), [288](stride-gs-app/src/lib/apiRouter.ts#L288)) — but `buildGroupedEntries(GROUPED_BILLING_EXTRAS, …)` is spread LAST into `GAS_TO_SB_MAP` at [line 301](stride-gs-app/src/lib/apiRouter.ts#L301), so the grouped entries win (object-literal "last key wins").

Effect: even after operator flips `feature_flags.commitStorageCharges='supabase'`, the action routes to `billing-extras-sb`, which [proxies the call straight back to GAS via `gas-proxy.ts`](stride-gs-app/supabase/functions/billing-extras-sb/index.ts#L74). The individual SB EFs `commit-storage-charges-sb`, `sync-client-billing-sb`, `void-unbilled-rows-sb` are **dead code on the live router** today.

This is the same shape of bug recorded in `feedback_grouped_routing_overrides_direct.md` (memory). The fix is to remove `commitStorageRows`, `syncClientBilling`, `voidUnbilledRows` from `GROUPED_BILLING_EXTRAS`. **Applied in this PR.**

---

## 2 — Per-handler audit

### 2.1 `createInvoice` → [create-invoice-sb](stride-gs-app/supabase/functions/create-invoice-sb/index.ts) — **needs-fix (HIGH)**

| Check | Status | Notes |
|---|---|---|
| EF exists, substantive | ✓ | 434 lines |
| Uses `next_invoice_no()` SEQUENCE | ✓ | [line 251](stride-gs-app/supabase/functions/create-invoice-sb/index.ts#L251), the v38.182 race fix invariant |
| Writes `public.billing` | ✓ | UPDATE 4 cols: `invoice_no`, `status='Invoiced'`, `invoice_date`, `updated_at` ([L273-L277](stride-gs-app/supabase/functions/create-invoice-sb/index.ts#L273)) |
| **Writes `public.invoice_tracking`** | **✗ MISSING** | EF never INSERTs into `invoice_tracking`. GAS does. Without this, SB-created invoices are invisible to the React Invoices tab's push-state column until QBO/Stax push fills in the row. |
| Reverse writethrough to per-tenant `Billing_Ledger` sheet | ✓ | Inline `fetch` ([L354-L397](stride-gs-app/supabase/functions/create-invoice-sb/index.ts#L354)), best-effort, logs failures to `gs_sync_events` |
| Uses shared `_shared/reverse-writethrough.ts` helper | ✗ | Duplicates the GAS fetch logic inline. Cosmetic / divergence risk. |
| CB `Consolidated_Ledger` write | n/a | Intentionally skipped per MIG-005 (P4b boundary); GAS still writes CB. |
| Schema mismatches | None | All 19 SELECT columns + 4 UPDATE columns present in `public.billing`. |
| Routing wired | ✓ | [apiRouter.ts L232](stride-gs-app/src/lib/apiRouter.ts#L232), DIRECT, flagKey=`createInvoice`. |

**Verdict:** cannot flip to `active_backend='supabase'` until the missing `invoice_tracking` INSERT lands. This is the same shape as the v38.180 createInvoice incident — GAS adds the tracking row in `handleCreateInvoice_`; the SB rewrite quietly skipped it.

**Recommended fix (separate PR):**
- After the UPDATE that stamps `invoice_no` on the billing rows, INSERT a row to `public.invoice_tracking` with `invoice_no`, `tenant_id`, `client_name`, `invoice_date`, `total` (SUM of the row totals), `line_count` (COUNT of distinct rows), `auto_charge` (from the input flag).
- Idempotency: invoice_no is PK; if reissue / retry hits, use `ON CONFLICT (invoice_no) DO UPDATE SET total = ..., line_count = ...`. Confirm with Justin whether retry should refresh totals or be a no-op.

### 2.2 `voidInvoice` → [void-invoice-sb](stride-gs-app/supabase/functions/void-invoice-sb/index.ts) — **READY**

| Check | Status | Notes |
|---|---|---|
| EF exists, substantive | ✓ | 250 lines |
| SB-first per PR [#552](https://github.com/Stride-dotcom/Stride-GS-app/pull/552) | ✓ | Commit `67ce6f51` confirms. GAS-side `handleVoidInvoice_` PATCHes `public.billing` to Void BEFORE sheet + CB cleanup. EF moves reverse-writethrough fan-out behind `EdgeRuntime.waitUntil` ([L228](stride-gs-app/supabase/functions/void-invoice-sb/index.ts#L228)) so SB writes return ~100ms before the sheet mirror completes. |
| `public.billing` writes | ✓ | `status='Void'`, `item_notes` appended with `\| Voided: <reason>`, `updated_at`. |
| `public.invoice_tracking` | n/a in EF | GAS post-handler deletes the row via `api_deleteInvoiceTrackingRow_`. Schema has no `status` column — delete is the void semantic. |
| Reverse writethrough | ✓ | Per-row, deferred via `EdgeRuntime.waitUntil`, logs failures to `gs_sync_events`. |
| `storage_billing_items` Void flip | ✓ (in GAS post-handler) | Allows re-billability of the same item-day after void. |
| Routing | ✓ | [apiRouter.ts L233](stride-gs-app/src/lib/apiRouter.ts#L233), DIRECT, flagKey=`voidInvoice`. |

**Verdict:** ready to flip. Note PR #552 already pre-patches `public.billing` from GAS, so flipping `active_backend='supabase'` is mostly a routing change — the SB-first write is already happening today via the GAS path.

### 2.3 `reissueInvoice` → [reissue-invoice-sb](stride-gs-app/supabase/functions/reissue-invoice-sb/index.ts) — **needs-fix**

| Check | Status | Notes |
|---|---|---|
| EF exists, substantive | ✓ | 250 lines, plus [reissue-invoice-shadow](stride-gs-app/supabase/functions/reissue-invoice-shadow/index.ts) (audit-shape dry-run, 77 lines). |
| Atomic unwind | ✓ | UPDATE billing SET `status='Unbilled'`, clear `invoice_no`/`invoice_date`, append notes ([L118-L151](stride-gs-app/supabase/functions/reissue-invoice-sb/index.ts#L118)). |
| **Pre-commit Unbilled re-check** | **✗ MISSING** | This is BUILD_STATUS.md hardening backlog item #9. The 2026-05-05 incident: a stale-Void row (voided by concurrent task reopen) got picked onto a new invoice. The EF's `.in('status', ['Invoiced','Void'])` filter shields only against concurrent void, not concurrent invoice. The reissue path needs a row-level re-check at commit time. Same gap exists in GAS — not a regression but should be closed before flipping. |
| **`storage_billing_items` reset** | **✗ MISSING** | GAS [StrideAPI.gs:15777-15782](AppScripts/stride-api/StrideAPI.gs) flips `storage_billing_items` rows back to Unbilled for re-billing. EF skips this. After flip, reissuing a storage row will silently leave it stuck. |
| Reverse writethrough | ✓ | Per-row, best-effort, logs to `gs_sync_events`. |
| Routing | ✓ | [apiRouter.ts L234](stride-gs-app/src/lib/apiRouter.ts#L234), DIRECT, flagKey=`reissueInvoice`. |

**Verdict:** do NOT flip until storage_billing_items reset is added. Pre-commit Unbilled re-check is the bigger architectural fix and matches the broader hardening backlog item #9 — track separately.

### 2.4 `syncClientBilling` → [sync-client-billing-sb](stride-gs-app/supabase/functions/sync-client-billing-sb/index.ts) — **router-fix**

| Check | Status | Notes |
|---|---|---|
| EF exists | ✓ | 95-line bridge. Delegates back to GAS via `writeThroughReverse?op=resync` ([L50-L54](stride-gs-app/supabase/functions/sync-client-billing-sb/index.ts#L50)). Acceptable as transitional per MIG-005. |
| Direct vs grouped | **✗ blocked** | Direct entry at [apiRouter.ts L284](stride-gs-app/src/lib/apiRouter.ts#L284) is shadowed by grouped entry at [L301](stride-gs-app/src/lib/apiRouter.ts#L301). Fix: remove from `GROUPED_BILLING_EXTRAS`. |
| Schema | n/a | EF writes only to `entity_audit_log` + `gs_sync_events`; the GAS-side resync is the actual writer. |

**Verdict:** ready after the routing fix (applied below).

### 2.5 `updateBillingRow` → [update-billing-row-sb](stride-gs-app/supabase/functions/update-billing-row-sb/index.ts) — **READY**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 160 lines, faithful GAS mirror. |
| Status guard (Unbilled-only) | ✓ | [L54](stride-gs-app/supabase/functions/update-billing-row-sb/index.ts#L54). |
| Rate/qty/total recompute | ✓ | `Math.round(rate*qty*100)/100` same as GAS. |
| Reverse writethrough | ✓ | Async via `mirror()`, logs failures. |
| Inventory propagation (sidemark, reference, description) | ✓ | Mirror of GAS `api_propagateItemFieldsToInventory_`. |
| Routing | ✓ | [L287](stride-gs-app/src/lib/apiRouter.ts#L287). |

### 2.6 `generateUnbilledReport` → [generate-unbilled-report-sb](stride-gs-app/supabase/functions/generate-unbilled-report-sb/index.ts) — **READY**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 288 lines, read-only. |
| Filter parity with GAS | ✓ | endDate, clientFilter, svcFilter, sidemarkFilter, includeStorage. |
| Output shape | mostly | EF returns `tenantId` field where GAS returned `sourceSheetId`. React consumers must adapt (same-tenant only, so functionally equivalent). |
| CB `Unbilled_Report` sheet write | n/a | GAS writes a CB sheet copy; EF skips. Consumers that previously read the CB sheet directly would lose the side-effect. Verify React-side: no consumer reads CB Unbilled_Report — they read the response payload directly. |
| Routing | ✓ | [L257](stride-gs-app/src/lib/apiRouter.ts#L257). |

### 2.7 `commitStorageRows` (flagKey: `commitStorageCharges`) → [commit-storage-charges-sb](stride-gs-app/supabase/functions/commit-storage-charges-sb/index.ts) — **router-fix**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 281 lines. Uses `generate_storage_charges` RPC; per-window dedup; ledger_row_id derivation matches GAS scheme `STOR-SUMMARY-{tenantId}-{sidemark}-{YYYYMMDD}-{YYYYMMDD}`. |
| Idempotent | ✓ | RPC deletes in-window Unbilled rows before insert. Re-runs safe. |
| `public.billing` writes | ✓ | Full column coverage. |
| `storage_billing_items` per-item tracking | ✓ | RPC populates per-item rows with `summary_ledger_row_id` backfilled. |
| Reverse writethrough | ✓ | Inline ([L221-L260](stride-gs-app/supabase/functions/commit-storage-charges-sb/index.ts#L221)), best-effort. |
| Direct vs grouped | **✗ blocked** | Direct entries for `generateStorageCharges` + `commitStorageRows` at [L230-L231](stride-gs-app/src/lib/apiRouter.ts#L230), but `commitStorageRows` is also in `GROUPED_BILLING_EXTRAS` at [L136](stride-gs-app/src/lib/apiRouter.ts#L136). Grouped wins for the commit action. Fix: remove from group. |

### 2.8 `addManualCharge` → [add-manual-charge-sb](stride-gs-app/supabase/functions/add-manual-charge-sb/index.ts) — **READY (1-line tweak)**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 150 lines. Mirror of GAS `handleAddManualCharge_` / `sbBillingRow_`. |
| ledger_row_id idempotent | ✓ | `MANUAL-{ms}-{rand6}` same as GAS. |
| `public.billing` INSERT | ✓ | All required columns. **Missing `reference: ''`** — GAS `sbBillingRow_` includes it ([StrideAPI.gs:7688]). Cosmetic; column defaults to NULL which is functionally equivalent but inconsistent. **Fixed below.** |
| Reverse writethrough | ✓ | `mirror()` posts via GAS writeThroughReverse with op=`insert`. |
| Routing | ✓ | [L285](stride-gs-app/src/lib/apiRouter.ts#L285). |

### 2.9 `voidManualCharge` → [void-manual-charge-sb](stride-gs-app/supabase/functions/void-manual-charge-sb/index.ts) — **READY**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 116 lines; richer than GAS (audit-log insert + notes annotation). |
| MANUAL- prefix enforced | ✓ | [L34-L35](stride-gs-app/supabase/functions/void-manual-charge-sb/index.ts#L34). |
| Unbilled-only guard | ✓ | [L53-L55](stride-gs-app/supabase/functions/void-manual-charge-sb/index.ts#L53). |
| `entity_audit_log` insert | ✓ | EF improves on GAS by writing audit directly. |
| Reverse writethrough | ✓ | Fire-and-forget via `mirror()`. |
| Routing | ✓ | [L286](stride-gs-app/src/lib/apiRouter.ts#L286). |
| Minor gap | — | GAS calls `invalidateClientCache_` post-handler; EF skips. Cache invalidation downstream of GAS writeThroughReverse — verify whether sheet-mirror handler triggers it. Non-blocking. |

### 2.10 `voidUnbilledRows` → [void-unbilled-rows-sb](stride-gs-app/supabase/functions/void-unbilled-rows-sb/index.ts) — **router-fix**

| Check | Status | Notes |
|---|---|---|
| EF substantive | ✓ | 128 lines. Per-row UPDATE with audit-log insert and mirror. |
| Unbilled-only guard | ✓ | [L66-L69](stride-gs-app/supabase/functions/void-unbilled-rows-sb/index.ts#L66). |
| Reverse writethrough | ✓ | Per-row via `mirror()`. |
| `storage_billing_items` reset | ✗ | Not handled. Also not handled in GAS. Pre-existing gap; affects re-billability of STOR rows voided via this path. Track separately — both paths should add it. |
| Direct vs grouped | **✗ blocked** | Direct entry at [L288](stride-gs-app/src/lib/apiRouter.ts#L288), grouped at [L137](stride-gs-app/src/lib/apiRouter.ts#L137) wins. Fix: remove from group. |

---

## 3 — feature_flags state

[Seed migration 20260509000001_migration_parity_substrate.sql](stride-gs-app/supabase/migrations/20260509000001_migration_parity_substrate.sql#L109-L136) seeded 25 rows at `(active_backend='gas', parity_enabled=false)`. Of the 10 billing handlers:

| function_key | Seeded? | Notes |
|---|---|---|
| `createInvoice` | ✓ | seed L124 |
| `voidInvoice` | ✓ | seed L125 |
| `reissueInvoice` | ✓ | seed L126 |
| `commitStorageCharges` | ✓ | seed L123 (the flag for both `generateStorageCharges` + `commitStorageRows`) |
| `billingExtras` | ✓ | seed in [20260524120000](stride-gs-app/supabase/migrations/20260524120000_grouped_actions_feature_flags.sql#L27) (grouped) |
| `syncClientBilling` | **✗** | not in any seed migration |
| `updateBillingRow` | **✗** | not in any seed migration |
| `generateUnbilledReport` | **✗** | not in any seed migration |
| `addManualCharge` | **✗** | not in any seed migration |
| `voidManualCharge` | **✗** | not in any seed migration |
| `voidUnbilledRows` | **✗** | not in any seed migration |

The user's `UPDATE … WHERE function_key IN (…)` would silently no-op for the 6 unseeded keys (and `commitStorageCharges` may not match if the user meant the literal `commitStorageCharges` key — verify the spelling).

A new migration in this PR seeds the 6 missing rows AND enables shadow on all 10 + billingExtras in a single idempotent file. See section 4.

---

## 4 — Migration SQL (in this PR)

File: [stride-gs-app/supabase/migrations/20260601000000_billing_shadow_enable.sql](stride-gs-app/supabase/migrations/20260601000000_billing_shadow_enable.sql).

Two parts:
1. **INSERT … ON CONFLICT DO NOTHING** seeds the 6 missing billing function_keys at `(gas, parity_enabled=false)`.
2. **UPDATE** flips `parity_enabled=true, shadow_backend='supabase'` on all 11 billing-related flags, guarded by `WHERE active_backend='gas'` (per the established MIG-007 pattern from `20260514210100_complete_task_feature_flag.sql`).

This file is **operator-pending** — per `feedback_supabase_deploy_token.md` the builder env has no `SUPABASE_ACCESS_TOKEN`. Justin runs `apply_migration` via MCP.

---

## 5 — Code fixes applied in this PR

| Fix | File | Risk |
|---|---|---|
| **Remove grouped routing override** for `commitStorageRows`, `syncClientBilling`, `voidUnbilledRows` | [stride-gs-app/src/lib/apiRouter.ts](stride-gs-app/src/lib/apiRouter.ts) | Low — actions still routed to GAS when flag is `gas` (default). After flip, they route to their individual EFs instead of being proxied back to GAS via billing-extras-sb. |
| **Add `reference: ''`** to add-manual-charge-sb row | [stride-gs-app/supabase/functions/add-manual-charge-sb/index.ts](stride-gs-app/supabase/functions/add-manual-charge-sb/index.ts) | Zero — column was already NULL, now empty string for parity with GAS `sbBillingRow_`. |

---

## 6 — Flagged for follow-up (not fixed in this PR)

**Block flipping `createInvoice`:**
- [ ] Add `invoice_tracking` INSERT (with `ON CONFLICT (invoice_no) DO UPDATE`) to `create-invoice-sb` after the billing UPDATE.

**Block flipping `reissueInvoice`:**
- [ ] Add `storage_billing_items` reset to `reissue-invoice-sb` (mirror StrideAPI.gs:15777-15782 logic).
- [ ] Decide on pre-commit Unbilled re-check pattern (BUILD_STATUS #9). This is broader hardening that should land in both `reissue-invoice-sb` and `create-invoice-sb`.

**Nice-to-haves (not blocking):**
- [ ] Refactor `create-invoice-sb` reverse-writethrough to use `_shared/reverse-writethrough.ts` helper (currently inline; risk of divergence).
- [ ] `generate-unbilled-report-sb`: confirm no React consumer reads CB `Unbilled_Report` sheet (EF skips the CB write GAS performs).
- [ ] `void-manual-charge-sb`: verify `invalidateClientCache_` equivalent fires via GAS writeThroughReverse downstream.
- [ ] Add `storage_billing_items` Void flip to `void-unbilled-rows-sb` (and to GAS `handleVoidUnbilledRows_` symmetrically) — neither path handles it today.

---

## 7 — Cutover plan (after the blocking fixes land)

Per MIG-016 deploy order (memory `feedback_mig016_routing_pattern.md`):

1. **GAS first** — any GAS-side hardening (e.g. for `reissueInvoice`, the storage_billing_items reset belongs in `handleReissueInvoice_` too if not already).
2. **EF deploy** — apply the SB EF code fixes via Supabase MCP (operator pending action; builder cannot deploy without `SUPABASE_ACCESS_TOKEN`).
3. **feature_flags flip** — apply `20260601000000_billing_shadow_enable.sql` first (shadow mode). Watch `parity_results` for 7d. If clean → second migration sets `active_backend='supabase'` per-handler.
4. **Per-handler flip order** (recommended, lowest risk first):
   1. `generateUnbilledReport` — read-only, no consequence.
   2. `updateBillingRow` — single-row, status-guarded.
   3. `voidManualCharge` — single-row.
   4. `addManualCharge` — single-row INSERT.
   5. `voidUnbilledRows` — bulk, but per-row guarded.
   6. `syncClientBilling` — transitional, bridge to GAS.
   7. `commitStorageRows` — monthly, idempotent.
   8. `voidInvoice` — already SB-first via PR #552; flipping is mostly a no-op since GAS still pre-patches.
   9. `reissueInvoice` — only after the two blocking gaps are closed.
   10. `createInvoice` — the #1 handler. Flip last and only after `invoice_tracking` INSERT is verified end-to-end (Invoices tab populates → QBO push → Stax push).

Each flip should be a per-tenant canary first (set `tenant_scope` to one low-volume tenant) per MIG-010, then expand fleet-wide after 14 days clean.
