# Stride GS App — Build Status

> Last updated: 2026-05-09 ([MIGRATION-P1.4] deployed as Web App v495. `GAS_API_URL` + `GAS_API_TOKEN` Edge Function secrets confirmed already set; SB→GAS reverse-writethrough plumbing is ready end-to-end. Phase 1 now 6/7 done — only P1.7 replay harness remains).

---

## Recent Changes (2026-05-09, [MIGRATION-P1.4] reverse SB→Sheets writethrough)

**Trigger:** P1.4 from the Phase 1 sub-task list. Per **MIG-002** (synchronous SB→Sheets reverse writethrough) the rollback insurance for any function flipping to `active_backend='supabase'` is a per-tenant-sheet mirror that the SB-side handler keeps current. P1.4 ships that insurance as substrate; per-table writers fill in alongside each function migration in P2/P3/P4.

**What landed (StrideAPI.gs v38.200.0):**

- New `doPost` case `"writeThroughReverse"` → routes to `handleWriteThroughReverse_(payload, callerEmail)`.
- New dispatcher `handleWriteThroughReverse_` validates the payload contract (`tenantId`, `table`, `op` ∈ {insert, update, delete}, `rowId` for update/delete), opens the per-tenant spreadsheet, dispatches to a per-table writer in `REVERSE_WRITETHROUGH_TABLES_`, and on failure logs to `gs_sync_events` with `action_type='writethrough_reverse'` (so failures surface in the React FailedOperationsDrawer just like GAS→SB writethrough failures).
- New registry `REVERSE_WRITETHROUGH_TABLES_` with 14 table entries — every table from the parity_dryrun mirror set in P1.3. **Every entry is a stub** today (`__writeThroughReverseStub_` throws "not yet implemented (P1.4 framework only)"). Per-table writers ship in their corresponding function-migration PRs.
- Auth model: existing API_TOKEN bearer at the top of `doPost` is the single auth surface. The Edge Function caller passes the same token. No per-action HMAC (future hardening).

**What landed (SB-side TypeScript helper):**

- New `supabase/functions/_shared/reverse-writethrough.ts` (~140 lines, first file in `_shared/`).
- `reverseWritethrough(input)` — strict mode. Throws on missing env vars, network error, HTTP non-2xx, or GAS-side `success: false`. Caller decides whether to surface or swallow.
- `reverseWritethroughBestEffort(input)` — catch wrapper. Logs to `console.error` and returns `{ success: false, error }`. Matches the existing GAS→SB `api_writeThrough_` semantics (best-effort, never blocks).
- Reads `GAS_API_URL` + `GAS_API_TOKEN` from Edge Function secrets — see Pending User Action.

**Idempotency by design:**

The GAS-side per-table writers are required to be idempotent by row identifier — calling twice with the same row produces the same sheet state. That sidesteps an idempotency-key store: at-least-once delivery from the Edge Function is safe because the receiver squashes duplicates. This convention is documented in the dispatch comments and is load-bearing for every per-table writer that ships in P2+.

**Code review (Opus subagent) flagged + fixed:**
- **Tenant validation hardening.** Added `api_isKnownTenantId_(tenantId)` — checks `public.clients.spreadsheet_id` via PostgREST GET before `openById`. Fails closed on Supabase outage. Without this, a leaked API_TOKEN could write to non-Stride sheets the script account has access to (Master Price List, Consolidated Billing, etc.).
- **Idempotency contract sharpened.** Dispatcher comment now explicitly says writers MUST derive sheet primary key from SB row contents, never from `lastDataRow + 1` or any counter that depends on order of arrivals. Re-delivery with such a counter would produce duplicate rows.
- **Retry-cron interaction documented.** The new `action_type='writethrough_reverse'` intentionally does NOT match the existing `retryFailedSyncs_` LIKE pattern (which would call `resyncEntityToSupabase_` — wrong direction for our use case). Recovery is operator-driven via FailedOperationsDrawer; a future parallel retry cron may ship later.

**Pins (do not regress):**
- The registry `REVERSE_WRITETHROUGH_TABLES_` MUST stay aligned with the `parity_dryrun` mirror set in `MIGRATION_STATUS.md` "parity_dryrun schema-sync convention." Both sides cover the same table set; an entry missing from one likely means the other is wrong.
- Per-table writers MUST be idempotent by row identifier. **Specifically: writers MUST derive their sheet primary key purely from SB row contents (Ledger Row ID, Task ID, Item ID, etc.). Writers MUST NOT use `lastDataRow + 1` or any counter whose value depends on the order of arrivals — that breaks idempotency silently.** This contract is documented at the top of the dispatcher's comment block.
- The endpoint relies on `API_TOKEN`-based auth at `doPost` top — do not introduce a code path that bypasses that validation.
- `tenantId` MUST be validated against `public.clients.spreadsheet_id` before `openById` (via `api_isKnownTenantId_`). Without this guard, a leaked API_TOKEN could be used to write to non-Stride sheets the script account happens to have access to. Helper fails CLOSED on Supabase outage — better to reject a legit reverse writethrough during a transient outage than to allow a writethrough to an unknown sheet.
- `action_type='writethrough_reverse'` intentionally does NOT match the `*_write_through` LIKE pattern that `retryFailedSyncs_` picks up. That cron retries via `resyncEntityToSupabase_` which syncs in the GAS→SB direction — opposite of what a reverse-writethrough failure needs. Operator-driven recovery via FailedOperationsDrawer is the today path; a parallel retry cron may ship in a future PR.

**What this PR does NOT do:**
- No per-table writers — all stubs. Calling this endpoint with any `table` returns a clear "not yet implemented" error.
- No P1.7 (replay harness).
- Token signing / HMAC — future hardening; v1 trusts the bearer token.

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.199.0 → v38.200.0; +~155 lines including comments)
- `stride-gs-app/supabase/functions/_shared/reverse-writethrough.ts` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.4 → done; new pending action for Edge Function secrets)

**Pending user action:**
- [x] ~~Deploy GAS~~ — **done**: deployed as Web App v495 at 2026-05-09 ~05:18Z.
- [x] ~~Set `GAS_API_URL` + `GAS_API_TOKEN` Edge Function secrets~~ — **already set** in Supabase dashboard (confirmed by Justin 2026-05-09). SB→GAS reverse-writethrough plumbing is ready end-to-end. P2 unblocked from this dependency.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.6] Settings → Migration tab)

**Trigger:** P1.6 from the Phase 1 sub-task list. With the substrate (P1.1), input capture (P1.2), `parity_dryrun` schema (P1.3), and the React resolution layer (P1.5) in place, the operator needed a visible surface to inspect and toggle flags. P1.6 ships that surface.

**What landed (React, Bundle: `index-BNJREu5o.js`):**

- New `src/components/shared/MigrationSettingsTab.tsx` (~340 lines). Reads via `useAllFeatureFlags()` (realtime-subscribed via `FeatureFlagContext`); writes via direct `supabase.from('feature_flags').update(...)` calls (RLS allows admin writes).
- New `'migration'` tab on `Settings.tsx`:
  - Added to `Tab` type, `TABS` array (with `adminOnly: true`), and `VALID_TABS`.
  - Tab nav filtered to exclude admin-only tabs for non-admins.
  - Render block: `{tab === 'migration' && isAdmin && <MigrationSettingsTab />}`. Non-admin direct URL hit shows an "admin-only" placeholder; URL state preserved.
- Per-flag row controls:
  - **Active backend** chip (gas/supabase) — click to flip.
  - **Parity** checkbox — when enabled, auto-sets `shadow_backend` to the opposite of `active_backend`; when disabled, clears `shadow_backend`.
  - **Tenant scope** textarea — comma-separated tenant IDs; saved values are deduped (`Array.from(new Set(...))`) and trimmed; empty → `NULL` (fleet-wide).
  - **Mismatches (7d)** column read from `feature_flags.mismatch_count_7d` — stays at 0 until the replay harness (P1.7) ships and starts populating it.
  - **Last check** column read from `last_parity_check`.
- Master switch — `Emergency Revert (Master Switch)` button in the header card. Always enabled (so a frantic operator can re-click). Confirmation dialog (`ConfirmDialog`) with explicit "currently affected" copy + "what changes" breakdown.
- Phase grouping (P2 / P3 / P4a / P5 / P6) with empty phases skipped. Phase mapping is in a `PHASE_FOR_KEY` table at the top of the file — keep in sync with `MIGRATION_STATUS.md` "Per-function migration table" if either drifts.

**MIG-003 refined (this PR):**
The master-switch implementation issues a single atomic PostgREST UPDATE:
```ts
.from('feature_flags')
.update({ active_backend: 'gas', tenant_scope: null })
.gte('function_key', '');  // every row
```
Per **MIG-010** semantics, clearing `tenant_scope` is REQUIRED alongside `active_backend='gas'` — leaving a non-null scope would route non-listed tenants to the opposite backend (supabase), which is the opposite of "emergency revert." `parity_enabled` and `shadow_backend` are intentionally NOT touched: post-revert, parity diagnostics keep flowing so the operator can confirm the regression is gone before re-attempting. `MIGRATION_STATUS.md` MIG-003 has the refined write-up.

**Code review (Opus subagent) flagged + fixed:**
- Predicate switched from `.neq('function_key', '')` (fragile against an empty-string seed row) to `.gte('function_key', '')` (matches every non-null PK).
- Narrowed master switch to clear only the two fields MIG-003 authorizes.
- Tenant-scope save dedups via `Array.from(new Set(...))`.
- Always-enabled master button.
- Removed unused `borderLight` fallback (the theme value exists).
- Pulled duplicated `mismatch_count_7d > 0` check to a const.

**Code review deferred:**
- Optimistic-state flicker on parity toggle between `setSavingKey(null)` and the realtime UPDATE echo (~50-200ms). Cosmetic. Tracked as a follow-up.
- Replacing the React-side master switch with a `revert_all_feature_flags()` SECURITY DEFINER RPC for cleaner audit + named entry point. Functionally equivalent today; tracked as a P1.6 follow-up.

**Pins (do not regress):**
- The Settings tab `'migration'` MUST stay admin-only. The TABS filter is the primary guard; the per-tab render guard is defense-in-depth for direct URL navigation.
- The master switch MUST clear `tenant_scope` alongside `active_backend` (see MIG-003 refined).
- `feature_flags` realtime publication is load-bearing — if removed, cross-tab flag flips would require manual refresh.

**Files touched:**
- `stride-gs-app/src/components/shared/MigrationSettingsTab.tsx` (new)
- `stride-gs-app/src/pages/Settings.tsx` (Tab type, TABS array, VALID_TABS, nav filter, render block)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.6 → done, MIG-003 refined)

**Pending user action:**
- [ ] After deploy, hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) → Settings → Migration. Verify: 25 flags listed grouped by phase, all `gas`, no console errors. Try toggling one flag's `active_backend` — should flip + persist + propagate to a second open tab (realtime). Flip it back. Try the Emergency Revert button (with no flags actually flipped, this is a no-op but verify the dialog opens cleanly).

---

## Recent Changes (2026-05-09, [MIGRATION-P1.5] FeatureFlagProvider + hooks)

**Trigger:** P1.5 from the Phase 1 sub-task list. Now that the substrate (P1.1), GAS-side input capture (P1.2), and `parity_dryrun` schema (P1.3) are in place, the React app needs a way to resolve which backend to call per migration function. Hook + context now exist; nothing CALLS them yet — that comes in P2 when the first handler flips.

**What landed (React, Bundle: `index-CkUuWxyQ.js`):**

- New `src/contexts/FeatureFlagContext.tsx`. `FeatureFlagProvider` fetches all rows from `public.feature_flags` on mount and subscribes to realtime so cross-tab flag flips propagate without a refresh. State: `flagsByKey` (Record<function_key, FeatureFlagRow>), `loading`, `error`. Falls back to `'gas'` (safe default) on Supabase outage so the App layout never crashes.
- Hooks:
  - `useFeatureFlag(key)` → `'gas' | 'supabase'`. The everyday hook for routing decisions in component code.
  - `useFeatureFlagRow(key)` → full row, for the Settings UI (P1.6).
  - `useAllFeatureFlags()` → sorted array of all rows.
  - `useFeatureFlagLoading()` → for callers that need to render a spinner.
- Pure resolver `resolveFlagBackend(flag, tenantId)` exported for non-React callers (replay tooling, admin scripts).
- `main.tsx` wires `FeatureFlagProvider` between `AuthProvider` (consumed for primary tenant) and `BatchDataProvider` (so any other context can use feature flags if it ever needs to).

**Per-tenant scope semantics (new — see MIG-010 in `MIGRATION_STATUS.md`):**

`feature_flags.function_key` is the primary key, so one row per function. The single row carries `active_backend` and optional `tenant_scope` array. Resolution:
- `tenant_scope IS NULL` → `active_backend` applies fleet-wide.
- `tenant_scope` set, caller IN it → `active_backend`.
- `tenant_scope` set, caller NOT in it → opposite of `active_backend`.

This lets a single row express "canary tenant X on SB, everyone else still on GAS" by setting `{active_backend:'supabase', tenant_scope:['X']}`. Documented inline at the top of `FeatureFlagContext.tsx` plus full decision write-up under `MIG-010`.

**Pins (do not regress):**
- The hook MUST default to `'gas'` on any failure path — Supabase outage, missing flag row, missing user, anything. `'gas'` is the pre-migration backend; defaulting to it can never accidentally route through an SB handler that may not exist or be ready.
- The hook resolves against `user.clientSheetId` (primary tenant), NOT `accessibleClientSheetIds` or any impersonated tenant. Canary should be exercised under the real user's tenant.

**What this PR does NOT do:**
- No call sites consume the hook yet. Every existing routing decision still calls GAS unconditionally. P2 wires in the first handler.
- No Settings → Migration UI yet (P1.6). The hooks for that UI exist but the surface itself ships separately.
- No `parity_enabled` shadow-execution path yet. That ships with P1.7 (replay harness) and the per-handler shadow Edge Functions in P2+.

**Files touched:**
- `stride-gs-app/src/contexts/FeatureFlagContext.tsx` (new, 270 lines)
- `stride-gs-app/src/main.tsx` (provider wired in)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.5 → done, MIG-010 added)

**Pending user action:**
- [ ] Hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) after deploy to pick up `index-CkUuWxyQ.js`. No visible change — flags loaded silently in the background. Verify in DevTools Network → Supabase REST → `feature_flags?select=*` returns 25 rows.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.3] parity_dryrun schema)

**Trigger:** Per **MIG-001** (dry-run-on-shadow inside prod SB) the replay harness needs a write target separate from `public.*`. P1.3 ships that target as a `parity_dryrun` Postgres schema with column-shape mirrors of every `public.*` table that any handler in the migration inventory writes.

**What landed:** `supabase/migrations/20260509000002_parity_dryrun_schema.sql` (applied via MCP).

- New `parity_dryrun` schema. service_role-only (REVOKE PUBLIC, GRANT USAGE service_role); not visible to `authenticated` or `anon` JWT roles, so it stays out of the React app's RLS surface.
- 14 mirrored tables built via `LIKE public.X INCLUDING DEFAULTS`: `inventory`, `tasks`, `repairs`, `shipments`, `will_calls`, `will_call_items`, `billing`, `addons`, `invoice_tracking`, `entity_notes`, `item_photos`, `clients`, `stax_invoices`, `stax_charges`. Column shapes match public.* byte-for-byte (verified column-count parity at 17/26/45/15/34/10/20/37/13/11/20/28/9/22).
- `INCLUDING DEFAULTS` carries expression defaults (e.g. `gen_random_uuid()`) but NOT constraints, indexes, identity sequences, or RLS — by design. The harness supplies all values explicitly; the mirror only needs the right SHAPE for state-hashing.
- New `parity_dryrun.reset()` plpgsql function (SECURITY DEFINER, EXECUTE granted to service_role only) — TRUNCATEs all 14 mirrors with RESTART IDENTITY. The replay harness calls this at the start of each run to prevent prior-run state from leaking into the diff.
- New `parity_dryrun.row_counts` view — diagnostic surface for the Settings → Migration tab (P1.6) to show "harness writing recently?" indicators.

**Pins (do not regress):**
- The mirror set is documented in `stride-gs-app/MIGRATION_STATUS.md` "`parity_dryrun` schema-sync convention." Every future `ALTER TABLE public.X ...` against a mirror member MUST be paired with a matching `ALTER TABLE parity_dryrun.X ...` in the same migration file. Drift breaks the replay harness silently.
- The mirror set must NOT be added to the Realtime publication. Shadow writes are internal — they should never trigger a frontend listener.

**What this PR does NOT do:**
- No realtime publication on parity_dryrun (correct — see above).
- No replay harness yet (P1.7).
- No reverse writethrough (P1.4) — that comes alongside the first function flipping to `active_backend='supabase'` in P2.
- Drift-detection check (column-count parity in CI) deferred to P1.7 alongside the replay harness.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260509000002_parity_dryrun_schema.sql` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.3 → done; new "parity_dryrun schema-sync convention" section)

**Pending user action:** none for P1.3.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.2] GAS-side input capture)

**Trigger:** P1.1 (PR #310) created `public.gas_call_log` and `entity_audit_log.correlation_id` but neither was populated yet. P1.2 wires the GAS side so every `doPost` call to StrideAPI lands a row in `gas_call_log` and threads its `correlation_id` through every `api_auditLog_` write produced during the same request. Together this gives the replay harness (P1.7) the (input → output) join it needs to verify the SB-side rewrite against historical GAS outputs.

**What landed (StrideAPI.gs v38.199.0):**

- New file-scope `__MIG_CORRELATION_ID__` global (set per-request, single-threaded execution makes this safe in GAS).
- New `api_logCallInput_(action, payload, tenantId, performedBy)` helper. Generates a UUID, sets `__MIG_CORRELATION_ID__`, POSTs to `public.gas_call_log` with `correlation_id`, redacted payload, SHA-256 input hash, `tenant_id`, `status='started'`, `called_at`. Best-effort — Supabase outage logs and continues, never blocks the handler.
- New `api_redactPayloadForCorpus_(payload)` helper. Whitelists the structural fields that matter for replay (action, ids, statuses, amounts, sidemarks, scope flags). Drops anything else, replaces fields matching `/token|secret|key|password|card|ssn|cvv|pii|email|phone/i` with `"[redacted]"`. Caps output at 1KB; strings cap at 200 chars; arrays cap at 50 elements.
- `api_auditLog_` now reads `__MIG_CORRELATION_ID__` and stamps it onto every `entity_audit_log` row. The check is a `typeof !== "undefined"` guard so the function still works when called outside `doPost` (script triggers, manual admin entries) — those simply produce rows with `correlation_id IS NULL`.
- `doPost` calls `api_logCallInput_` once after token validation + JSON parse, before the routing switch — so spam/auth-fail requests don't pollute the corpus, but every successfully routed call gets captured.

**Pins (do not regress):**
- Per **MIG-006**, `entity_audit_log` + `gas_call_log` is the canonical answer key for replay. The `correlation_id` linkage between the two tables is load-bearing — any future refactor must preserve it.
- The redaction whitelist is the boundary between operational data and customer PII. New fields added to the corpus should be reviewed for PII exposure before joining the whitelist.

**What this PR does NOT do:**
- No status update on call completion. `gas_call_log.status` stays `'started'` — the replay harness infers success from `entity_audit_log` rows existing for the correlation_id, error from their absence + a `gas_call_log` row. Per-call success/error stamping requires a `doPost`-wide response-capture refactor and is deferred to a small follow-up. Net acceptable for now: replay harness joins on correlation_id whether status is updated or not.
- No P1.3 (`parity_dryrun` schema), no P1.4 (reverse writethrough), no P1.5 (React `FeatureFlagProvider`), no P1.6 (Settings UI), no P1.7 (replay Edge Function).

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.198.0 → v38.199.0)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.2 → done, verify deferred)

**Deploy:** `npm run push-api && npm run deploy-api` ran 2026-05-09 ~05:01–05:02 UTC. Web App now at version 494.

**Smoke check (2026-05-09, ~05:07 UTC, ~5 min post-deploy):**
- `gas_call_log` total rows: **0**.
- `entity_audit_log` rows since deploy: **8** — all are `source='backfill:v1'` with future `performed_at` timestamps (Oct–Dec 2026); not real-time `doPost` traffic. `correlation_id IS NULL` on all 8, which is correct (backfill rows never go through `doPost`).
- **Conclusion:** zero post-deploy `doPost` traffic in the verification window (Friday evening PST, warehouse not actively writing). Code path can't be exercised without organic traffic. Deploy is live (Web App v494 confirmed); first real `doPost` call will populate `gas_call_log`.

**Pending user action:**
- [ ] **Monday-morning re-check.** Run this query after the warehouse has been active for ~10 minutes:
  ```sql
  SELECT
    (SELECT COUNT(*) FROM public.gas_call_log) AS total_calls_captured,
    (SELECT COUNT(*) FROM public.entity_audit_log WHERE correlation_id IS NOT NULL) AS audit_rows_with_correlation,
    (SELECT COUNT(*) FROM public.gas_call_log gcl INNER JOIN public.entity_audit_log eal ON eal.correlation_id = gcl.correlation_id) AS joined_pairs;
  ```
  Expected: all three non-zero. If `joined_pairs > 0` we have working (input → output) pairs and the replay corpus is live.
- [ ] If verification fails (zero rows even after organic traffic), check Apps Script execution logs at https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/executions for `api_logCallInput_` errors.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.1] parity substrate)

**Trigger:** Per `MIGRATION_STATUS.md` Phase 1 sub-tasks, P1.1 is the first deliverable that everything else hangs off — without `feature_flags` and `gas_call_log` in place, neither GAS-side input capture (P1.2) nor the replay harness (P1.7) has anywhere to write.

**What landed:** `supabase/migrations/20260509000001_migration_parity_substrate.sql` (applied via MCP). Four pieces:

- `public.feature_flags` — per-function backend selector. Columns: `function_key` (PK), `active_backend` (`gas`|`supabase`, default `gas`), `shadow_backend` (nullable), `parity_enabled` (bool), `tenant_scope` (text[], NULL = fleet-wide), `last_parity_check`, `mismatch_count_7d`, `notes`, `created_at`, `updated_at`. RLS: authenticated read, admin write, service_role bypass. `updated_at` trigger. Realtime publication enabled for the future Settings → Migration tab. Seeded with **25 rows** covering every function in the migration inventory at `active_backend='gas'` (today's reality — non-disruptive).
- `public.parity_results` — per-call match record from the replay harness (P1.7). Columns include `function_key`, `tenant_id`, `call_id` (links to `gas_call_log.correlation_id`), `fixture_id` (non-null for parity-fixture runs), `gas_state_hash`, `sb_state_hash`, `match`, durations, `mismatch_details` (jsonb diff). RLS: staff/admin read, service_role write. Partial index on `match=false` for the mismatches dashboard.
- `public.gas_call_log` — raw input payload for every `doPost_` call. Columns: `correlation_id` (UNIQUE — threads through `entity_audit_log`), `action`, `input_redacted` (jsonb), `input_hash`, `tenant_id`, `user_id`, `gas_duration_ms`, `status` (`started`/`success`/`error`), `called_at`, `completed_at`. P1.2 wires this from the GAS side.
- `public.entity_audit_log.correlation_id` — new nullable text column + partial index. Joins each state change to the `gas_call_log` row that produced it. The replay harness reconstructs (input → output) pairs from this join.

**Pins (do not regress):**
- Per **MIG-001 / MIG-008**, the parity substrate lives in the prod SB project — no cloned-app architecture. Credential-absence is enforced via per-shadow-Edge-Function placeholder env vars in P1.7, not by standing up a second project.
- Per **MIG-006**, `entity_audit_log` + `gas_call_log` is the canonical answer key for replay. Any future schema change to `entity_audit_log` must preserve the `correlation_id` linkage.

**What this PR does NOT do:** No GAS-side code changes (P1.2). No `parity_dryrun` schema (P1.3). No reverse writethrough harness (P1.4). No React `FeatureFlagProvider` (P1.5). No Settings UI (P1.6). No replay Edge Function (P1.7). All seeded `feature_flags` rows stay at `active_backend='gas'`, so no production handler routing changes — the substrate is invisible to operators until P1.5/P1.6 ship.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260509000001_migration_parity_substrate.sql` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.1 → done)

**Pending user action:** none for P1.1 specifically. Justin's nomination of a canary tenant is still pending but doesn't gate P1.

---

## Recent Changes (2026-05-08, GAS→Supabase migration roadmap review)

**Trigger:** Justin shared `Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap.docx` (v1.0, May 2026) for review before any Phase 1 work begins. Cross-referenced against current `CLAUDE.md` invariants + this file's "Recent Changes" / "Open hardening backlog" sections. Net: skeleton is sound, but 4 blocking design flaws and 13 stale/missing items would derail execution as written. Produced corrected v1.1.

### Blocking design flaws in v1.0 (must resolve before Phase 1)

1. **Parity model doesn't compose for writes.** "Both GAS and SB process the same input, results compared" creates duplicate side effects: two invoice numbers from `next_invoice_no()`, two PDFs, two customer emails, two `Billing_Ledger` rows, two CB rows, two QBO pushes. Replays the v38.182 dup-invoice incident class on every shadowed createInvoice. v1.1 reframes write parity as **dry-run-on-shadow**: SB-side runs the full code path against a parity scratch schema (or in a transaction that always rolls back) and compares the *would-have-been* state against the GAS-authored state. No external side effects from the shadow side.
2. **CB Consolidated_Ledger is missing entirely.** v1.0 only addresses the per-tenant `Billing_Ledger` sheet. The three-storage-layer model (per-tenant sheet + `public.billing` + CB sheet) is unmentioned. Bugs #5 and #7 in the open hardening backlog are exactly this class. v1.1 splits Phase 4 into 4a (per-tenant + SB mirror) and 4b (CB retirement / QBO-direct push), with explicit migration of the IIF auto-import pipeline.
3. **Rollback semantics are lossy.** "Hourly SB→Sheets sync" + "master switch reverts to GAS-primary" loses up to 60 min of writes on rollback. v1.1 specifies synchronous SB→Sheets writethrough (replacing today's GAS→SB writethrough) with the same best-effort semantics already proven in `api_writeThrough_`, plus per-tenant rollback (one tenant at a time, not master switch).
4. **`completeTask` cannot be split across Phase 3 and Phase 4.** `handleCompleteTask_` writes status, billing row, addon rows, and email send in one lock. Same for `handleCompleteRepair_` and `handleProcessWcRelease_`. v1.1 collapses these into Phase 4 in full.

### Stale function-inventory entries in v1.0

The following were marked "GAS" in v1.0 but are already partially or fully migrated per current code state:

- **Email migration is largely shipped.** Session 90 (PRs #174-#182) moved `notify-new-order`, `notify-public-request`, `ONBOARDING_EMAIL`, `CLAIM_RECEIVED`/`MORE_INFO`/`DENIAL`, `ORDER_REJECTED`, `ORDER_REVISION_REQUESTED`, `ACCOUNT_REFRESH_INVITATION` to `send-email` (Resend). Phase 3 plan should only cover the still-on-GAS senders: shipment created/updated emails, INSP_EMAIL (blocked on PDF source), CLAIM_SETTLEMENT (blocked on PDF source), task complete/repair quote/repair complete emails.
- **`createInvoice` listed twice** in v1.0's status tables (Write Functions row + Billing & Payments row). Single canonical row in v1.1.
- **`generateStorageCharges`** — Postgres RPC already shipped (PR #189). What remains is the GAS commit-to-ledger path. v1.1 corrects.
- **`releaseItems`** — bulk-rewritten in PR #186 (v38.142.8). Performance-sensitive baseline for any SB-side parity comparison.
- **`transferItems`** — overhaul shipped in session 92: `inventory_live` view, provenance columns, auxiliary-table migration on transfer. Phase 5 must build on this, not start fresh.
- **DispatchTrack module** entirely SB-only (already-Done case study). Not credited in v1.0's inventory.
- **Marketing, Intake, Audit log, In-app notifications** — also entirely SB-only. Missing from v1.0.

### Missing pieces v1.1 adds

- **`next_invoice_no()` SEQUENCE pin.** Explicit "SB-side createInvoice continues to call `public.next_invoice_no()`; never reach back to the Master-RPC `getNextInvoiceId`." Closes the regression footgun.
- **`invoice_tracking` table reference.** PR #285 (v38.194) already provides per-invoice QBO/Stax push state. Phase 4/6 builds on this, not parallel to it.
- **RLS write-policy review section.** Today's RLS covers reads (`user_has_tenant_access` helper, multi-tenant access fix). Direct-from-React writes need write policies on every affected table — section enumerates the 18+ tables that need them.
- **49 per-tenant Apps Script projects.** Phase 7 decommission must enumerate `Code.gs` v4.6.0, `Import.gs` v4.3.0, and `StaxAutoPay.gs` v4.7.6 across each tenant's own Apps Script project. Rollout-script-equivalent is needed to either retire the per-client scripts or freeze them at a known version.
- **GAS time-driven triggers.** `runBillingAnomalySweep` (manual), KC's rollout/sync triggers, Stax Auto Pay daily charge run, daily sync events — each becomes either `pg_cron` or a scheduled Edge Function invocation.
- **Existing-tenant migration story.** v1.0 only described new-client onboarding post-cutover. v1.1 adds explicit per-tenant cutover sequence: pick a low-volume canary tenant, run dry-run parity for 2 weeks, hot-cut that tenant only, observe 7 days, expand.
- **Canary plan.** No staging environment exists; `feature_flags` gain a `tenant_id` scope so a flag can be flipped for one tenant before the fleet.
- **Drive folder URL story.** Every entity row carries a Drive folder URL referenced from emails and the Entity History tab. v1.1 specifies: keep URLs as data (don't break old emails), redirect new uploads through Supabase Storage (already the case for photos/documents).
- **Master switch redesign.** v1.0's "flip ALL flags simultaneously" defeats the per-function-flag rollout. v1.1 keeps the granular flags as the rollout mechanism and reframes "master switch" as an emergency global rollback toggle (one-way: flip everything back to GAS), not a forward cutover.
- **Timeline reset.** v1.0's 14 weeks is optimistic given the parity-for-writes design problem. v1.1 leaves estimates blank pending Phase 1 execution; commits to re-estimating after the parity infrastructure is in place and one canary function has shipped.

**Files touched (this session):**
- `stride-gs-app/BUILD_STATUS.md` (this entry)
- `Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap_v1.1.docx` (corrected roadmap; original v1.0 preserved alongside)

**Pending user action:**
- [ ] Justin: review v1.1, decide whether to proceed with Phase 1 (parity infrastructure + feature_flags table) or pause for further design review on the dry-run-on-shadow parity model.

---

## Current Versions

| System | Version | Notes |
|---|---|---|
| React app (GitHub Pages) | Latest on `origin/source` | `npm run deploy` from source. Latest bundle: `index-C2xeMz3s.js`. |
| StrideAPI.gs | **v38.194.0** (deployed v487) | Invoice Review overhaul backend hooks. New `public.invoice_tracking` table with per-invoice push-state ledger (`qbo_pushed_at`, `stax_pushed_at`, `auto_charge` snapshot). `handleCreateInvoice_` upserts on commit; `handleQboCreateInvoice_` + `handleQbExport_` PATCH the corresponding push timestamp on success; `handleVoidInvoice_` + `handleReissueInvoice_` delete the tracking row. Companion React rewrites the Invoice Review tab to read from `invoice_tracking` with sortable columns, multi-select bulk push, and realtime subscription. v38.193 hardening pass remains in place (B2 pre-commit Status assertion, B3+B4 CB symmetry, C3 sidemark uniqueness, C4 anomaly sweep, D Re-issue button). |
| Supabase | 70+ migrations applied | New `public.invoice_tracking` table (PR #285) — per-invoice push-state ledger with `qbo_pushed_at`, `stax_pushed_at`, `auto_charge` snapshot. RLS staff/admin only + service_role bypass. Realtime publication enabled. 176 historical invoices backfilled. `public.next_invoice_no()` Postgres SEQUENCE replaces the Master sheet RPC counter for invoice numbering. Multi-tenant RLS access (`user_has_tenant_access` helper) — clients with multiple tenant assignments can now read entity rows + storage objects across all accessible tenants. |
| Client scripts | Rolled out to 49 active clients | Code.gs v4.6.0, Import.gs v4.3.0 |
| StaxAutoPay.gs | v4.7.6 | Charge Log Customer/Transaction header fix |

---

## What's Built

### Pages (33 files in `src/pages/`)

**Main pages (14):** Login, Dashboard, Inventory, Receiving, Shipments, Tasks, Repairs, Will Calls, Billing, Payments/Stax, Claims, Settings, Marketing, Orders/Delivery

**Entity detail pages (5):** ItemPage, TaskPage, RepairPage, WillCallPage, ShipmentPage — full-page entity views replacing slide-out panels

**Job pages (4, legacy):** TaskJobPage, RepairJobPage, WillCallJobPage, ShipmentJobPage

**Specialized:** Scanner (QR), Labels, QuoteTool, PriceList, PublicRates, Intakes (client onboarding), ParityMonitor, DetailPanelMockup, ClientIntake, AccessDenied

### Hooks (61 in `src/hooks/`)

Data: useInventory, useTasks, useRepairs, useWillCalls, useShipments, useBilling, useClaims, useClients, useUsers, useOrders, useLocations, useMessages, useNotifications, usePhotos, useDocuments, useEntityNotes, useProfiles

Detail: useItemDetail, useTaskDetail, useRepairDetail, useWillCallDetail, useShipmentDetail

Delivery: useDeliveryZones, useAvailabilityCalendar, useOrders

Billing: useBillingActivity, useBillingParityLog, usePaymentTerms, useServiceCatalog, useQBO, usePricing, useItemClasses, useCoverageOptions

UI: useTablePreferences, useResizablePanel, useIsMobile, useRowSelection, useVirtualRows, useSidebarOrder, useClientFilter, useClientFilterUrlSync, useUniversalSearch, useAutocomplete, useAsyncAction, useApiData

Other: useCalendarEvents, useExpectedShipments, useFailedOperations, useSupabaseRealtime, useItemIndicators, useItemNotes, useClientIntake, useIntakeAdmin, useClientTcStatus, useClientInsurance, usePriceListShares, useQuoteCatalog, useQuoteStore, useEmailTemplates, useReceivingAddons, useDashboardSummary

### Shared Components (60 in `src/components/shared/`)

Detail panels (7): ItemDetailPanel, TaskDetailPanel, RepairDetailPanel, WillCallDetailPanel, ShipmentDetailPanel, ClaimDetailPanel, BillingDetailPanel, OrderDetailPanel, PaymentDetailPanel

Modals: CreateDeliveryOrderModal, CreateTaskModal, CreateWillCallModal, AddToWillCallModal, ReleaseItemsModal, TransferItemsModal, CreateClaimModal, OnboardClientModal, BulkReassignModal, BulkScheduleModal, ChangePasswordModal, IntakeEmailModal, PreChargeValidationModal

UI components: FloatingActionMenu, WriteButton, BatchGuard, ActionTooltip, BatchProgress, UniversalSearch, DataTable, DetailHeader, EntityPage, EntityHistory, EntitySourceTabs, EntityAttachments, StatusChips, DeepLink, InfoTooltip, InlineEditableCell, LocationPicker, AutocompleteSelect, MultiSelectFilter, FolderButton, ConfirmDialog, ProcessingOverlay, FailedOperationsDrawer, ReviewQueueTab, TemplateEditor, TabbedDetailPanel, and more

### Edge Functions (6 deployed)

| Function | Purpose |
|---|---|
| `dt-push-order` | Push approved delivery orders to DispatchTrack API |
| `dt-webhook-ingest` | Receive DT webhook events, upsert orders |
| `dt-backfill-orders` | Bulk import existing DT orders |
| `dt-sync-statuses` | Sync DT status/substatus lookup tables |
| `notify-new-order` | Email notification on new delivery order |
| `stax-catalog-sync` | Sync service catalog items to Stax payment platform |

### Supabase Tables (57 migrations)

**Core mirrors:** inventory, tasks, repairs, will_calls, will_call_items, shipments, billing, clients, claims, cb_users, locations

**Delivery (DT):** dt_orders, dt_order_items, dt_order_history, dt_order_photos, dt_order_notes, dt_webhook_events, dt_credentials, dt_orders_quarantine, dt_statuses, dt_substatuses, dt_address_book, delivery_availability, delivery_zones (pricing)

**Billing/pricing:** service_catalog (+ stax_item_id, qb_item_id), billing_activity_log, billing_parity_log, stax_invoices, stax_charges, stax_exceptions, stax_customers, stax_run_log

**Content:** entity_audit_log, entity_notes, documents, messages, message_recipients, conversations, email_templates, photos, expected_shipments, price_list_shares, quotes

**Marketing:** marketing_contacts, marketing_campaigns, marketing_templates, marketing_settings

**Client onboarding:** client_intakes (+ coverage options, TC templates, invite templates, auto-inspect, notifications)

**Infrastructure:** gs_sync_events, item_id_ledger, move_history, profiles, audit_log

### Key Features

- Universal Search (⌘K) across all entities
- Inline editing on Inventory (6 columns with autocomplete)
- Cross-tab Realtime sync via Supabase postgres_changes
- Optimistic UI on all status changes, field edits, creates
- Role-based access (admin/staff/client) with sidebar + route guards
- Delivery order creation with zone-based pricing, review queue, admin auto-push to DT
- Stax payment integration (invoicing, charging, auto-pay)
- QuickBooks IIF export + QBO catalog sync
- Entity page redesign (full-page views replacing slide-out panels)
- Photos, documents, notes per entity with Supabase storage
- iMessage-style messaging system
- Client onboarding intake system
- Quote Tool with PDF generation
- Expected operations calendar
- QR Scanner + Labels (native React, Supabase-backed)

---

## Recent Changes (2026-05-05, Invoice Review overhaul — invoice_tracking + new tab UI)

**Trigger:** Build plan from Justin: "All tracking in Supabase only, per invoice_no, separate QBO + Stax timestamps, sortable columns, multi-select bulk push, realtime, autopay filter."

**Five steps shipped (StrideAPI.gs v38.193 → v38.194 / Web App v487; React bundle `index-C2xeMz3s.js`):**

- **Step 1 — Migration `invoice_tracking`** ([supabase/migrations/20260505000001_invoice_tracking.sql](supabase/migrations/20260505000001_invoice_tracking.sql)). New `public.invoice_tracking` table PK on `invoice_no`, columns: `tenant_id`, `client_name`, `invoice_date`, `total`, `line_count`, `auto_charge`, `created_at`, `qbo_pushed_at`, `stax_pushed_at`. RLS staff/admin via JWT user_metadata.role + service_role bypass. Realtime publication enabled. Backfill: 176 invoices from billing where status=Invoiced; `qbo_pushed_at` + `stax_pushed_at` proxied from existing `stax_invoices.created_at` for the 79 already-pushed invoices (new pushes refine to per-path timestamps).

- **Step 4 — Auto-populate on create.** `handleCreateInvoice_` POSTs to `invoice_tracking` right before the success return. `auto_charge` is snapshotted from `public.clients` via Supabase REST at create time so historical invoices keep their original Stax-eligibility regardless of later flag flips. Upsert on `invoice_no` merge-duplicates so the v38.157 half-write recovery path can re-enter.

- **Step 3a — QBO push hook.** `handleQboCreateInvoice_` collects `pushedInvoiceNos` from `results[]` after the per-invoice loop and PATCHes `qbo_pushed_at = now()` in one PostgREST round-trip via `invoice_no=in.(...)`.

- **Step 3b — Stax push hook.** `handleQbExport_` does the same with `batchInvoiceNos` for `stax_pushed_at`, right after the existing `supabaseBatchUpsert_("stax_invoices", ...)` so the IIF auto-import + tracking stamp travel together.

- **Cleanup hook.** New helper `api_deleteInvoiceTrackingRow_(invoiceNo)` called from `handleVoidInvoice_` + `handleReissueInvoice_` after their existing CB cleanup so voided/re-issued invoices disappear from the Invoice Review tab. The voided rows still appear on Billing → Report (Status=Void) for historical reference.

- **Step 2 — Invoice Review tab rewrite.** `Billing.tsx` `InvoiceReviewTab` now reads from `invoice_tracking`. New columns (all sortable via header click): checkbox, expand-arrow, Invoice #, Client (with Auto Pay icon), Invoice Date, Total, Items, Created, QBO ✓+date | —, Stax ✓+date | n/a | —, Actions. Filters: search, client dropdown, push-status (All / Not pushed to QBO / Not pushed to Stax), Auto Pay only toggle, date range. Bulk action bar (sticky when ≥1 selected): Push to QBO (N), Push to Stax (N — gated when not all selected are auto_charge=true), Void (N), Clear selection. Single-row Re-issue + Void retained from v38.193. Line items lazy-fetched on row expand. Realtime subscription on `invoice_tracking` so multi-operator pushes propagate live. Optimistic timestamp stamps with rollback on error.

- **Step 5 — Payments page Stax push status visibility.** Deferred by design. Existing Payments → Review tab already lists pushed invoices via `stax_invoices` (whose presence implies a Stax push). `invoice_tracking` is queryable from anywhere in React; a follow-up can add an explicit "first pushed at" column if Justin wants the timestamp inline next to the existing Stax invoice list.

**Pending user actions:**
- [ ] Hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) to pick up `index-C2xeMz3s.js`
- [ ] Verify the new Invoice Review tab on Billing renders with checkbox, sortable columns, push-status columns, and the bulk action bar appears when 1+ invoices are checked
- [ ] Try a Push to QBO on a non-pushed invoice — green check should appear within ~1s
- [ ] (From v38.193) Re-run Create Invoices for Nip Tuck Remodeling + Mary Kenngott Design

---

## Earlier Changes (2026-05-05, billing hardening pass — bugs #3-#9 closed)

**Trigger:** `BILLING_HARDENING_HANDOFF.md` from the prior dup-number cleanup session. Five cousin bugs + three detection gaps + one missing UI affordance, all blocking Justin's re-run of Create Invoices for Nip Tuck Remodeling and Mary Kenngott Design.

**Audit (Phase A — 4 parallel Explore agents):** confirmed `handleCreateInvoice_` row-pick → write window for stale-Status drift; mapped every site that flips billing rows to Void (`handleVoidInvoice_`, `handleVoidUnbilledRows_`, `handleVoidManualCharge_`, `api_voidBillingRowsWhere_` via `handleReopenTask_` / `handleReopenRepair_`, `handleTransferItems_`); confirmed `handleGenerateStorageCharges_` math is sound (free-days + transfer-date split + discount + class-rate lookup); verified all three QBO/IIF push paths now correctly read `separate_by_sidemark` post-v38.191; surfaced one cousin gap (`handleImportIIF_` doesn't inherit per-client `auto_charge` on new rows) and one dead-code instance (`handleQbExcelExport_` reads AUTO CHARGE but never uses it).

**Six fixes shipped (StrideAPI.gs v38.193.0, deployment v486; React bundle `index-B2pd9yhv.js`):**

- **B2 — pre-commit Status assertion (Bug #4 + gap #9).** `api_markClientLedgerInvoiced_` now reads the Status column in the same `getValues()` as Ledger Row ID and refuses to flip rows whose Status drifted from "Unbilled" between React picking the row (from Supabase mirror) and GAS writing it. Throws `PRE_COMMIT_STATUS_ASSERTION` so `handleCreateInvoice_`'s existing catch path rolls back the CB append. Closes the chain that produced INV-000135 billing the legitimately-Voided `INSP-TASK-INSP-62630-1` row on 2026-05-03.

- **B3 + B4 — CB Consolidated_Ledger symmetry on void + reopen flows (Bugs #5 + #7).** Two new helpers — `api_deleteCbRowsByInvoiceNo_` and `api_deleteCbRowsByLedgerIds_` — placed near `api_markClientLedgerInvoiced_`. Both use the descending-grouped-`deleteRows` pattern from the `rollbackByInvoiceNo_` closure. Wired into `handleVoidInvoice_` (returns `cbRowsDeleted` in response) and `api_voidBillingRowsWhere_` (defense-in-depth — current Unbilled-only guard means CB is normally empty for these IDs). Pre-fix: voiding an invoice via the React UI flipped client sheet to Void but left CB rows tied to the voided invoice number stuck at Status=Invoiced, drifting QBO/IIF reconciliation.

- **C3 — server-side sidemark-uniqueness assertion (Bug #3 defense-in-depth).** `handleCreateInvoice_` now reads `clients.separate_by_sidemark` from Supabase REST and rejects payloads with mixed sidemarks for `true` clients (`SIDEMARK_VIOLATION`). React-side fix landed 2026-05-02 in `Billing.tsx`; this GAS-side guard catches a future React regression OR a hand-crafted payload (admin tool, scripted retry). Fails open on Supabase outage so a momentary outage can't block invoicing.

- **C4 — `runBillingAnomalySweep` admin function (gap #10).** Five checks against the last 30 days: duplicate `invoice_create` entries (the pre-v38.182 RPC race fingerprint), billing rows ≠ stax_invoices.line_items_json count for same invoice_no, mixed sidemarks for `separate_by_sidemark=true` clients, stale-Void rows whose `ledger_row_id` appears in `stax_invoices.line_items_json`, STOR rows with negative qty/total. Sends `justin@stridenw.com` an HTML summary if findings; clean sweeps are Logger-only. Trigger setup left as a manual operator step on purpose — never auto-installed.

- **D — Re-issue button (Bug #6).** New `handleReissueInvoice_` + `reissueInvoice` router action. Releases an invoice's billing rows back to Status=Unbilled, removes matching CB rows, queues `api_fullClientSync_(["billing"])`, writes one entity_audit_log entry. Idempotent. Replaces tonight's `runReleaseInvoicesForReissue` one-shot with a first-class API action — future race / operator-error cleanup is now one click instead of an emergency GAS push. Companion React: new `postReissueInvoice` in `lib/api.ts` + Re-issue button next to Void on the Invoices tab (staff/admin only) with explicit pre-condition confirm dialog (operator must void Stax/QBO first — endpoint doesn't touch external systems).

**Pre-flight (Phase E) results — all green:**
- E1 client config (Supabase): Digs Furniture (separate_by_sidemark=false), Mary Kenngott Design (true), Nip Tuck Remodeling (true) — all active. Matches the cleanup expectations.
- E2 released rows ready: Nip Tuck = 42 rows / $980 (NIPTUCK + NORTON); Mary Kenngott = 9 rows / $565 (POPLAWSKI + TWISP-BROWN). Matches the handoff predictions exactly.
- E3 stale Void rows: only the legitimately-Voided `INSP-TASK-INSP-62630-1` remains (correct — task was reopened 5/1).
- E4 duplicate invoice_create sweep: only the historical 2026-05-02/05-03 race events on INV-000131 (3×) and INV-000129 (2×); these triggered this work, not a regression. Atomic SEQUENCE prevents recurrence.

**Verdict: GREEN to re-run** Create Invoices for Nip Tuck + Mary Kenngott. Predicted invoice numbers (continuing today's sequence — last was INV-001128): Nip Tuck NORTON ≈ INV-001129 ($565), Nip Tuck NIPTUCK ≈ INV-001130 ($415), Mary Kenngott POPLAWSKI + Mary Kenngott TWISP-BROWN ≈ INV-001131 + INV-001132 (split $565).

**Files touched:** `AppScripts/stride-api/StrideAPI.gs` (v38.192.0 → v38.193.0), `stride-gs-app/src/lib/api.ts` (new `postReissueInvoice` + extended `VoidInvoiceResponse`), `stride-gs-app/src/pages/Billing.tsx` (handleReissue + Re-issue button on Invoices tab).

**Pending user action (post-deploy):**
- [ ] Justin: re-run Create Invoices for Nip Tuck Remodeling (will produce 2 invoices — NORTON + NIPTUCK — under fresh atomic-counter numbers)
- [ ] Justin: re-run Create Invoices for Mary Kenngott Design (will produce 2 invoices — POPLAWSKI + TWISP-BROWN)
- [ ] Justin: send the drafted Nip Tuck + Mary Kenngott customer emails after the new invoices are issued
- [ ] Justin (optional): wire the daily 6am `runBillingAnomalySweep` time-driven trigger via Apps Script editor → Edit → Triggers

---

## Earlier Changes (2026-05-05, dup-number race incident — triage, cleanup, hardening backlog)

**Trigger:** Nip Tuck Remodeling contact emailed flagging that invoice INV-000135 was a duplicate of lines 1-18 on INV-000131. Investigation confirmed the duplicate AND surfaced two cousin bugs that the v38.182 fix on Mon didn't reach.

**What was confirmed:**

The 2026-05-03 invoice batch hit the `getNextInvoiceId` race that v38.182.0 fixed Monday, but the bad invoices were generated **the day before the fix landed** (race timestamp 17:57:41 + 17:57:42 UTC, 1.18s apart, both successfully assigned INV-000131). A third "INV-000131" attempt at 22:40 UTC + a fresh INV-000135 at 23:19 UTC followed as Justin tried to manually recover. Net: customer received two PDFs containing 18 overlapping NIPTUCK line items totaling $450 that should have been on one invoice.

Same race also bit two other clients earlier (KC's batches): Digs Furniture INV-000115 (2.2s race, never pushed to Stax/QBO so no customer harm — but KC manually rebuilt one consolidated QB invoice covering all the line items) and Mary Kenngott INV-000129 (3.1s race, sent via QBO so customer-facing). Today's KC batch (130+ invoices, INV-001000 → INV-001128) ran post-fix with zero duplicates — atomic counter is holding.

**What got cleaned up:**

- **New StrideAPI.gs admin entry `runReleaseInvoicesForReissue` (v38.192.0)** — hardcodes the four affected (clientSheetId, invoiceNo) pairs, releases their billing rows back to Unbilled across all three storage layers (client Billing_Ledger sheet via RangeList sparse writes; CB Consolidated_Ledger via grouped-descending-deleteRows à la `rollbackByInvoiceNo_`; public.billing via `api_fullClientSync_`). Idempotent. Already executed once 2026-05-05 — 54 of 55 expected rows released, 1 row correctly stayed Void (legitimately voided 5/1 when Justin reopened the INSP-62630-1 inspection task). **Keep as historical reference; do not re-run.**

- **Stax + QBO voids** — operator-handled outside this session. Nip Tuck INV-000131 + INV-000135 voided. Mary Kenngott INV-000129 pending Justin's QBO void. Digs is closed by KC's manual QB consolidation invoice (3 freshly-released INV-000115 rows pending terminal Void via the React Billing → Report → Void Selected path).

- **Customer email drafts ready** — Nip Tuck (acknowledges duplicate + flags second issue: 7 NORTON line items truncated off original PDF; corrected NIPTUCK total $415 not $450 because of the legitimate INSP-62630-1 reopen-void), Mary Kenngott ($565 split into POPLAWSKI + TWISP-BROWN), Digs (template KC fills with QBO doc#).

**Verified clean:** Digs's April storage invoice INV-001044 ($87 / 3 items) cross-checked against actual inventory — every Digs item that crossed the 7-day grace into April is on the bill. 11 items released within grace (no charge by design — `DIGS DOES NOT COVER STORAGE FOR CLIENT AFTER 7 DAY GRACE PERIOD UNLESS AUTHORIZED`); 4 items received 4/27-4/30 still in grace, will appear on May. Storage generator is working correctly for Digs.

**Cross-corpus reconciliation (2026-05-06 follow-up):** scanned all 79 real-customer rows in `stax_invoices` (excluding tonight's 4 cleanup targets and demo data) — zero line-count or dollar-total mismatches against the billing table. Separately scanned for the bug #3 over-split signature (`separate_by_sidemark=false` clients with multiple same-day invoices each carrying a single sidemark) and surfaced one additional case beyond Digs: **Ligne Roset INV-000124 + INV-000125 on 2026-05-02** (17 RCVG rows blank-sidemark + 1 RCVG row sidemark "Martinez", $255 combined). Same root cause + same recovery as Digs — KC manually consolidated into one QB invoice; Stride-side rows stay `Status=Invoiced`, **no cleanup needed**, no inclusion in any release/regenerate scope. Confirmed with Justin 2026-05-06. Today's batch (INV-001000 → INV-001128) showed zero over-split signatures, confirming the React-side fix held; the v38.193 GAS-side assertion now blocks any future regression at the source.

**Files touched (this session):**
- `AppScripts/stride-api/StrideAPI.gs` (v38.190.0 → v38.191.0 → v38.192.0; one new admin function appended at end)
- React side untouched — fixes for the open hardening backlog (below) are deferred to the next session

**What's still open** — see "Open billing-system hardening backlog" below.

**Pending user action:**
- [ ] Justin: void Mary Kenngott INV-000129 in QBO + send drafted email
- [ ] Justin: void the 3 Digs INV-000115 rows via React Billing → Report → filter Digs Unbilled → Void Selected → reason "Already paid via KC manual QB consolidation 2026-05-02"
- [ ] Justin: send updated Nip Tuck email ($415 not $450)
- [ ] Justin: spawn next builder session with `BILLING_HARDENING_HANDOFF.md` (in Dropbox `Apps\GS Inventory\`) to ship the 5-bug hardening pass before re-running Create Invoices for Nip Tuck + Mary Kenngott

---

## Open billing-system hardening backlog (queued for next session)

The race itself is dead since v38.182, but the dup-number incident exposed five cousin bugs and three detection gaps. **All blocking** the Nip Tuck + Mary Kenngott re-run. Plan in `BILLING_HARDENING_HANDOFF.md`.

| # | Bug | Where | Severity |
|---|---|---|---|
| 3 | Invoice **generation** force-splits by sidemark even when `clients.separate_by_sidemark = false` (twin of v38.191 QBO-push fix, different code path) | `handleCreateInvoice_` and/or `Billing.tsx` `handleCreateInvoices` | **HIGH** — caused Digs's 7-invoice burst |
| 4 | Stale-Void rows get swept onto new invoices | `handleCreateInvoice_` Unbilled-row picker | **HIGH** — billed customer for a reopen-voided $35 inspection on INV-000135 |
| 5 | `handleVoidInvoice_` only voids client sheet, not CB Consolidated_Ledger | `StrideAPI.gs` ~line 12437 | MEDIUM — orphans counts diverge between systems |
| 6 | `handleVoidInvoice_` flips rows to terminal Void with no re-issue path | `StrideAPI.gs` ~line 12437 | MEDIUM — forced tonight's manual GAS one-shot recovery |
| 7 | Reopen-task workflow voids client sheet billing but not CB | Search `handleReopenTask_` / `handleCorrectTaskResult_` | HIGH — root cause of bug #4 |

**Detection gaps:**

| # | Gap | Fix |
|---|---|---|
| 8 | No reconciliation between billing-table line count and `stax_invoices.line_items_json` | Post-create assertion: refuse to push if mismatch |
| 9 | No pre-commit re-check that picked rows are still Unbilled | Pre-commit assertion in `handleCreateInvoice_` (closes #4) |
| 10 | No nightly anomaly sweep / admin email | `runBillingAnomalySweep` admin function, last-30-day check |

**Other deferred items:**
- One-click Re-issue button on the React Billing → Invoices tab (replaces manual GAS one-shot for future incidents)
- Fold the v38.192 `runReleaseInvoicesForReissue` admin entry into a generalized "release any invoice's rows" tool (currently hardcoded to the 4 specific invoices from this incident)

---

## Recent Changes (2026-05-04, background invoice batches + UX)

**Goal:** Stop blocking the UI during invoice creation. The blocking modal-with-spinner pattern made multi-client batches feel like a hostage situation — operators had to sit on the Billing page for 30+ seconds. After v38.183.0's lock-scope reduction made the per-invoice path fast enough, the UX overhang was the next obvious cleanup.

**What changed (React-only, no GAS / no migration):**

- **New `BillingBatchContext`** (`src/contexts/BillingBatchContext.tsx`) — App-level provider that owns the in-flight batch state: progress, succeeded/failed counts, in-progress ledger row IDs, results. Lives in `main.tsx` outside the route tree, so the state survives any page unmount or remount. Methods: `startBatch`, `recordInvoice` (per-invoice progress), `finishBatch`, `dismissResults`.

- **New `BillingBatchToast`** (`src/components/layout/BillingBatchToast.tsx`) — Bottom-right floating toast rendered in `AppLayout`. Shows "Creating N invoices… X/N done" while active, "✓ N invoices created" on full success (auto-dismiss after 6s), or "⚠ X of N — Y failed [View]" on partial failure with a click-through details modal. Visible from any page, so the operator can kick off an invoice batch on Billing then navigate to Inventory / Tasks and still watch the toast.

- **`Billing.tsx` `handleCreateInvoices` refactored.** Sequence now:
  1. Synchronous preflight (resolve rows, group by client+sidemark, optional storage commit, 20-invoice cap warning).
  2. On preflight success: `billingBatch.startBatch(...)` registers the batch, `setInvoiceStartedAt(Date.now())` flips the modal body to a green "✓ Invoice batch started!" confirmation, and a `setTimeout(2000)` schedules modal auto-close.
  3. The async `runBatchLoop` continues running. Inside the per-invoice `call`, `billingBatch.recordInvoice(...)` updates progress + drains the ledger ID from `invoicingLedgerIds` as each invoice completes.
  4. After the loop finishes: `billingBatch.finishBatch(results)` flips `active=false` and stamps `lastResults` for the toast's completion summary.

  The async chain doesn't get cancelled when Billing.tsx unmounts mid-batch — the JS runtime keeps the in-flight fetches and their `await` chains alive, and the context setters they call point at the App-level provider (which doesn't unmount). State updates that target Billing-local setters (e.g. `setReportData`) become no-ops after unmount, which is the desired behavior.

- **Per-row "Invoicing…" optimistic badge.** `Billing.tsx` Status column renderer checks `billingBatch.invoicingLedgerIds.has(row.ledgerRowId)` — when true, renders an animated pulse pill instead of the real status. Once the per-invoice POST returns and `recordInvoice` removes the IDs, the badge clears and the row falls back to its real `Invoiced` status from the writeThrough mirror.

- **Re-submit guard.** Submit button label flips to "Batch in progress — wait" + disabled while `billingBatch.active === true`. Avoids two concurrent batches stomping each other (overlapping optimistic hides, conflicting result UIs).

- **`pulse` keyframe** added to `index.css` for the badge + Started-state confirmation icon. Distinct from the existing `stridePulse` (which scales as well as fades) — `pulse` just gently breathes opacity.

**What survives:** page navigation within the app (Billing → Inventory mid-batch is fine; the toast keeps tracking, and coming back to Billing shows the live in-progress state).

**What does NOT survive:** a full page refresh / browser tab close. The browser cancels in-flight fetches. Surviving that requires persisting the queue to Supabase + a background worker; out of scope here.

**Files touched:**
- `stride-gs-app/src/contexts/BillingBatchContext.tsx` (new)
- `stride-gs-app/src/components/layout/BillingBatchToast.tsx` (new)
- `stride-gs-app/src/main.tsx` (wrap App in `<BillingBatchProvider>`)
- `stride-gs-app/src/components/layout/AppLayout.tsx` (render `<BillingBatchToast />`)
- `stride-gs-app/src/pages/Billing.tsx` (handleCreateInvoices refactor + Status column badge + Submit guard)
- `stride-gs-app/src/index.css` (pulse keyframe)

**Pending user action:**
- [ ] Smoke test: kick off a 5+ invoice batch → confirm modal closes after the green "Started!" confirmation (~2s) → verify rows show animated "Invoicing…" pill → navigate to Inventory or Tasks → toast in bottom-right keeps updating. Come back to Billing — if any rows still in flight, "Invoicing…" pills still show; if all done, rows show real Invoiced status. Toast shows "✓ 5 invoices created" and auto-dismisses after a few seconds.

---

## Recent Changes (2026-05-04, commit-lock scope reduction)

**Goal:** Unlock the rest of the parallelism the v38.182.0 atomic counter set up. v38.182.0 made the Master RPC race go away and let Billing.tsx restore concurrency=3, but the per-call wall-time barely budged because `handleCreateInvoice_`'s outer `LockService.getScriptLock` still wrapped the entire ~5-10s function. Concurrent calls just queued at the GAS lock instead of the Master RPC. This PR shrinks the lock to just the CB append phase and refactors the per-tenant flip for safe concurrent execution.

**What changed (StrideAPI.gs v38.183.0):**

- **Commit-lock window shrunk to the CB append phase only.** New `releaseCommitLockOnce_()` helper releases the lock right after `consolLedger.setValues(...)` + the rich-text writes (~500ms-1s of work). Everything before (idempotency check, race detection, building the row matrix) stays inside; everything after (per-tenant client Billing_Ledger flip, email, Email Status update) now runs without holding the lock.
- **`api_markClientLedgerInvoiced_` refactored to RangeList per-cell writes.** Critical for concurrency safety: the pre-v38.183 slice-setValues approach read a snapshot of the whole sheet and wrote a contiguous range covering minRow→maxRow. Two concurrent calls for the same client (e.g. two sidemark groups for a `separate_by_sidemark=true` client invoiced in parallel) would each read the snapshot and each write back overlapping slices, with the second overwriting the first invoice's just-flipped rows back to Unbilled. New code reads only the Ledger Row ID column, then uses `getRangeList()` per write column (Status / Invoice # / Invoice Date / Invoice URL) to write SAME-VALUE-PER-CELL across only the specific cells that need changing. Same per-call cost (one round-trip per column = up to 4 total) as the v38.142.9 slice approach, but sparse target shape means concurrent calls for different ledger row IDs can no longer clobber each other.
- **ID-based rollback (`rollbackByInvoiceNo_`).** Replaces the v38.157.0 position-based rollback that depended on the script lock being held throughout the function. The new path acquires its own brief re-lock, scans the Invoice # column for matching rows, and deletes bottom-up. Robust to other concurrent appends. Same orphan-pinning fallback when the rollback itself fails.
- **Email Status update — pre-fill optimization + opt-in lock.** When `skipEmail=true` (the default — operators only opt in for the legacy Drive-PDF email path), the CB append now pre-fills `Email Status = "Skipped"` so no post-flip update is needed. When email actually fires, the post-flip update briefly re-acquires the commit lock (~500ms-1s) so its bulk slice write doesn't race with concurrent CB appends.

**Speedup:** for a 5-client storage batch with concurrency=3 and email skipped (the typical Justin storage case), the wall-time goes from ~30-40s (post-v38.182.0) to ~12-18s (post-v38.183.0). Roughly 3x — the long-promised win.

**Safety:** the test plan below should specifically confirm that a `separate_by_sidemark=true` client with multiple sidemark groups invoiced in one batch ends up with all rows flipped to Invoiced (no race-induced revert to Unbilled).

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.183.0)

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/` after merge.
- [ ] Smoke test: pick a `separate_by_sidemark=true` client with at least 2-3 sidemarks of unbilled rows. Select rows from all sidemarks → Create Invoice. Confirm: distinct invoice numbers per sidemark, ALL rows flipped to Invoiced (no rows left as Unbilled), Consolidated_Ledger has all expected rows.

---

## Recent Changes (2026-05-04, atomic invoice counter)

**Goal:** Retire the Master sheet RPC counter race that caused the INV-000131 duplicate (2026-05-03) and forced Billing.tsx to pin its invoice loop at `concurrency=1`. Move invoice numbering to a Postgres atomic SEQUENCE.

**Root cause recap:** `api_nextInvoiceNo_` called a separate Apps Script project's `getNextInvoiceId` action — that handler reads-then-writes a counter on the Master Price List sheet without a transaction lock. Two concurrent createInvoice calls could both observe the same counter value, both increment, both return the same number. INV-000131 hit it: NORTON + NIPTUCK submitted within ~1.2s, both got INV-000131, the second commit's row-position-based rollback then chopped the wrong rows. v38.157.0 added half-write recovery; the workaround was to serialize the entire React-side loop.

**Fix:**

- **Migration `invoice_no_atomic_counter`** (`supabase/migrations/20260504220000_invoice_no_atomic_counter.sql`): creates `public.invoice_no_seq` SEQUENCE seeded at 1000 (currently MAX invoice = INV-000144; 850+ headroom is well past anything the Master RPC could plausibly have queued). New `public.next_invoice_no()` SQL function returns `'INV-' || LPAD(nextval(seq), 6, '0')` — atomic by design, concurrency-safe, no transient failure modes. Companion `public.peek_invoice_no_seq()` for diagnostics. Both functions GRANTed to authenticated + service_role.

- **StrideAPI.gs v38.182.0:** `api_nextInvoiceNo_` becomes a thin wrapper around the new `api_nextInvoiceNoSupabase_` helper. Legacy `rpcUrl/rpcToken` parameters kept for signature compat but ignored. The Master RPC counter is left in place but inert (other callers like `getNextShipmentNo` continue to use it; only invoice numbering migrated).

- **Billing.tsx:** `handleCreateInvoices` runBatchLoop bumps `concurrency` from 1 back to 3.

**Speedup expectation:** modest, ~10-30% wall-time reduction on multi-client batches. The dominant cost is `handleCreateInvoice_`'s outer `LockService.getScriptLock` for the Consolidated_Ledger commit phase — that still serializes per-invoice. True 3x parallelism requires refactoring that lock to per-tenant scope, which is a separate follow-up. The primary win of THIS PR is **eliminating the duplicate-number bug class entirely**.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504220000_invoice_no_atomic_counter.sql` (new)
- `AppScripts/stride-api/StrideAPI.gs` (v38.182.0)
- `stride-gs-app/src/pages/Billing.tsx`

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/` after merge. (Migration already applied via MCP.)
- [ ] Smoke test: create 2-3 invoices in quick succession (e.g. multi-client storage batch) → confirm distinct INV-001000+ numbers, no duplicates, no LOCK_TIMEOUT errors. The first new invoice ships at INV-001000 (the gap from INV-000144 → INV-001000 is intentional headroom).

---

## Recent Changes (2026-05-04, storage billing → one-click invoice)

**Goal:** Eliminate the legacy "Commit to Ledger then re-select on Report tab then Create Invoice" 4-step storage workflow. Replace with a single Create Invoice button on the Storage tab that does both in one click.

**What changed (React-only, no GAS):**

- **`Billing.tsx`** — new `invoiceMode: 'report' | 'storage'` state. Storage tab gains a primary "Create Invoice" button in the preview banner (next to the legacy "Commit to Ledger") and on the floating selection bar. Both open the existing Create Invoice modal with `invoiceMode='storage'`. Modal subtitle adds a yellow inline note: "Storage rows will be committed to each client's ledger and invoiced in one step."
- **`handleCreateInvoices`** — when `invoiceMode === 'storage'`, prepends a `postCommitStorageRows` call before the existing per-(client, sidemark) `postCreateInvoice` loop. The preview rows already carry `ledgerRowId = taskId` (matching what GAS stamps on the sheet), so the post-commit invoice loop finds the rows it needs to flip without any reshape. Failures during the commit phase abort cleanly with an error in the modal; partial commits surface failed clients in the same banner.
- **Inline editing on storage preview** — Sidemark + Reference are now editable on storage preview rows alongside the existing Rate / Qty / Notes editors. Important for `separate_by_sidemark=true` clients: the operator's sidemark edit decides which invoice the row lands on (group key uses the operator-provided value, not the inventory row's stale field).
- **Modal close handler** — when a storage-mode invoice succeeds, the preview banner is cleared (`previewLoaded=false`, `previewRows=[]`, `commitResult=null`) so the user lands on a clean slate. Clicking Preview Storage again won't re-surface the just-invoiced periods (the Postgres `calculate_storage_charges` RPC excludes already-invoiced periods).

**Performance note:** pure React orchestration — same end-to-end GAS work as the legacy two-button flow, just chained without a manual click in between. The bigger speed-up (atomic invoice numbering on Postgres → unlock `concurrency=3` in the per-group invoice loop, ~3x faster on multi-client batches) is tracked as a follow-up PR.

**Files touched:**
- `stride-gs-app/src/pages/Billing.tsx`

**Pending user action:**
- [ ] Smoke test: Storage tab → Preview Storage → click "Create Invoice" → confirm modal options (PDF, email, QBO push, Send to Payments) → submit → confirm invoices land in the Report tab + are properly grouped by sidemark for clients with `separate_by_sidemark=true`.

---

## Recent Changes (2026-05-04, multi-tenant RLS access fix)

**Bug:** A client user assigned to 3 tenants reported "Item not found" errors when clicking entity deeplinks. Root cause: every client-facing RLS policy across `inventory`, `tasks`, `repairs`, `will_calls`, `will_call_items`, `shipments`, `billing`, `claims`, `clients`, `client_insurance`, `entity_notes`, `entity_audit_log`, `documents`, `email_sends`, `item_photos`, `move_history`, `autocomplete_db`, `dt_address_book`, `dt_orders` (+ all `dt_order_*` children), `expected_shipments`, `photo_shares`, plus 4 storage policies (`documents`, `dt-pod-photos`, `invoices`, `photos` buckets) compared `tenant_id` against the JWT's single primary `clientSheetId`. The React layer correctly issued `.in('tenant_id', accessibleClientSheetIds)` for multi-tenant fetches, but RLS filtered the rows out before they reached React — so `useItemDetail` / `useTaskDetail` / etc. saw empty results and surfaced "not found." React access checks at the panel level never ran because the row never came back.

**Fix:**

- **Migration `multi_tenant_rls_access`** (`supabase/migrations/20260504210000_multi_tenant_rls_access.sql`): two new helper functions — `public.user_has_tenant_access(text)` for `tenant_id`-style columns and `public.user_has_tenant_access_storage(text)` for storage paths (handles the `_`→`-` substitution Supabase storage uses) — that return true if the input matches the user's primary JWT `clientSheetId` OR appears in the JWT's `accessibleClientSheetIds` array. Defaults to empty array when missing, so single-tenant users keep working with the legacy primary check. Every affected policy DROPped + CREATEd to call the helper, names preserved. Service-role + staff/admin paths unchanged.

- **AuthContext.tsx:** the metadata-sync `inSync` check (cached + full-verify paths) now also compares `accessibleClientSheetIds` and `childClientSheetIds` against the JWT, and the `supabase.auth.updateUser({ data })` call writes both arrays into `user_metadata`. New `arraysEqualOrderless` helper avoids re-firing `updateUser` on every page load when GAS returns the array in a different order. Single-tenant users see no behavior change.

**Why this is safe to ship without a backfill:** for client users who don't immediately log in, the new RLS helper falls back to the primary `clientSheetId` check (their JWT still works for their primary tenant). On their next login the AuthContext writes the full array into metadata and the secondary tenants light up automatically. Multi-tenant users who do log in immediately after deploy get the fix on next page-fetch.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504210000_multi_tenant_rls_access.sql` (new)
- `stride-gs-app/src/contexts/AuthContext.tsx`

**Pending user action:**
- [ ] Smoke test: have the affected multi-tenant client log in, switch tenants in the UI, and click a deeplink to an item in their secondary/tertiary tenant — should load instead of "not found." Migration is already live (applied via MCP).

---

## Recent Changes (2026-05-04, unified addons module)

**Goal:** Generalize the task-shaped `task_addons` system (shipped 2026-05-02 in PR #193, never used in prod) into a polymorphic addons module that plugs into any entity panel — tasks, repairs, will calls, and inventory — with one set of GAS + React code.

**Step 1 — Schema (migration `unified_addons`).** Drops `public.task_addons` (verified empty in prod via `execute_sql` before drop) and creates `public.addons` keyed on `(tenant_id, parent_type, parent_id)` with CHECK constraints (parent_type in `task|repair|will_call|inventory`, parent_id non-empty), `billed`/`billed_at`/`ledger_row_id` columns for traceback + idempotency, RLS for staff/admin + service_role, and realtime enabled.

**Step 2 — GAS materializer.** New `api_writeAddonsToLedger_(ss, parentType, parentId, ctx)` in StrideAPI.gs replaces the inline task-only addon flush. Reads unbilled rows from `public.addons` via REST, writes one Billing_Ledger row per addon (rate snapshotted at add time, falls back to current catalog if blank — same semantics as before), mirrors each row to Supabase via `resyncEntityToSupabase_`, then PATCHes the addon back to `billed=true` with the resulting `ledger_row_id` stamped. Idempotent — retries skip already-billed rows. Wired into `handleCompleteTask_` (replacing the inline flush), `handleCompleteRepair_`, and `handleProcessWcRelease_`. `api_fetchTaskAddons_` removed (subsumed). Per-parent column mapping: task → Task ID = `{parentId}-{svcCode}`, repair → Repair ID = `{parentId}-{svcCode}`, will_call → Shipment # = parentId, inventory → Item ID = parentId. Ledger Row ID format unchanged: `{parentId}-{svcCode}-ADDON-{n}`.

**Step 3 — React hook + modal.** New `useEntityAddons(parentType, parentId, tenantId)` hook with the same CRUD + realtime shape as the old `useTaskAddons`, plus a `billed` flag check on `updateAddon` so already-materialized addons can't be edited. `useTaskAddons` reduced to a one-line compat alias delegating to `useEntityAddons('task', ...)` so the existing TaskDetailPanel call site is unchanged. `AddTaskServiceModal` gains an optional `parentType` prop that drives title copy and catalog filter (tasks keep the historical `show_as_task` gate; other entities show all active services).

**Step 4 — BillingPreviewCard polymorphic addons.** Lifted the `entityType === 'task'` restriction at line 211 — projected addons now flow through for any entity type. Recorded fetch query broadened: repair now uses `repair_id.eq.X OR repair_id.like.X-%` (parallel to task's existing pattern) and will_call drops the `svc_code='WC'` filter so addon rows with non-WC service codes (Shipment # = wcNumber) show in the recorded panel. `isAddonBooked` simplified to check `addon.billed` first, then ledger_row_id pattern as fallback. The "+ Add Service" button is no longer task-only.

**Step 5 — Wire into entity panels.** `RepairDetailPanel` and `WillCallDetailPanel` each pull addons via `useEntityAddons` and pass `addons` + `onAddAddon`/`onUpdateAddon`/`onDeleteAddon` into `BillingPreviewCard`. Editable while the entity is still open (Repair: not Complete/Cancelled. WC: in {Pending, Scheduled, Partial}). TaskDetailPanel unchanged — picks up the polymorphic path automatically via `useTaskAddons`'s new alias.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504170000_unified_addons.sql` (new)
- `AppScripts/stride-api/StrideAPI.gs` (v38.177.0)
- `stride-gs-app/src/hooks/useEntityAddons.ts` (new)
- `stride-gs-app/src/hooks/useTaskAddons.ts` (compat alias)
- `stride-gs-app/src/components/shared/AddTaskServiceModal.tsx`
- `stride-gs-app/src/components/shared/BillingPreviewCard.tsx`
- `stride-gs-app/src/components/shared/RepairDetailPanel.tsx`
- `stride-gs-app/src/components/shared/WillCallDetailPanel.tsx`

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/`. (Migration already applied via MCP on 2026-05-04.)
- [ ] Smoke test: open a repair detail panel → add a "Rush Repair" addon → mark Complete → confirm a Billing_Ledger row appears with Ledger Row ID `{repairId}-RUSH-ADDON-1` and the addon flips to billed=true. Repeat for a will call (release) and a task.

**Step 2 deferral.** The follow-up work — making the billing pipeline Supabase-native so `handleCreateInvoice_` reads from `public.billing` instead of the client sheet — was explicitly scoped out per the handoff. Step 1 (this PR) keeps the existing client-sheet-as-authority pipeline; it's a half-day reversible change. Step 2 advances Decision #33 (out of Google) and is a separate strategic call.

---

## Recent Changes (2026-05-03, session 93 — Stax payments architectural cleanup)

**Goal:** Retire the Stax Customers Google Sheet as a separate data source. The list of "Stax Customers" should be derived from CB Clients (`stax_customer_id IS NOT NULL`) — single source of truth. Fix the duplicate INV-000131 issue on Stax Invoices sheet.

**Step 1 + 4 — React Customers tab refactor.** Payments → Customers tab now derives from `clients` directly via new `fetchStaxCustomersFromClients()` in `supabaseQueries.ts`. Renders the Billing Report's CreditCard + Auto Pay pill (driven by `auto_charge` + `stax_customer_id`). `Pull Customers (CB)`, `Sync With Stax`, `Sync Customers` buttons removed — no longer needed. Selected row gets explicit `orangeLight` background + `theme.colors.text` foreground so text stays readable through the slide-out's dim overlay (the prior `theme.colors.textMuted` was unreadable through the 20% black overlay). `pulling/syncing/custResult` state retired.

**Step 2 — GAS lookup from CB Clients.** New `stax_buildClientStaxMap_()` helper indexes CB Clients by Client Name, QB Customer Name, AND Stax Customer Name into the same record so divergent-name invoices match. Three Stax write paths (`handleQbExport_` auto-push at line ~20570, `handleImportIIF_` at line ~30160, `stax_lookupCustomerIds_` for the Refresh Stax IDs button) now resolve via this helper. The Stax Customers sheet is no longer read on the IIF/push path. Rows that resolve to a client without a Stax Customer ID are now logged as a `NO_CUSTOMER` exception and skipped, instead of inserted as half-populated PENDING rows.

**Step 3 — Dedup Stax Invoices by docNum.** Sheet-row dedup switches from the multi-field hash (`docNum|name|amount|date`) to the QB invoice number alone — fixes the duplicate INV-000131 issue Justin reported (re-import with a slightly drifted total/date built a different `stax_invoiceKey_`). Existing PENDING rows now UPDATE in place with the freshest customer / date / total / line items / Stax Customer ID; CREATED / PAID / VOIDED rows stay untouched.

**Step 5 — Cleanup migration.** New admin entry `runStaxSheetsCleanup` collapses the existing duplicate clutter (idempotent). Stax Invoices: dedupes by docNum, prefers PAID > VOIDED > CHARGE_FAILED/SENT > CREATED > PENDING, then non-empty Stax Invoice ID, then most recent Created At. Stax Customers: dedupes by (QB Name + Stax Customer ID), keeps the row with the most filled-in cells. Run once from the Apps Script editor.

**Files touched:**
- `stride-gs-app/src/pages/Payments.tsx` (Customers tab + drop sync buttons)
- `stride-gs-app/src/lib/supabaseQueries.ts` (`fetchStaxCustomersFromClients()`)
- `AppScripts/stride-api/StrideAPI.gs` (v38.153.0)

**Pending user action:**
- [ ] Run `runStaxSheetsCleanup` once from Apps Script editor to collapse the existing INV-000131 / Wignall x2 / Digs x7 ghosts.

PR: [#214](https://github.com/Stride-dotcom/Stride-GS-app/pull/214). StrideAPI.gs v38.153.0, Web App v443.

---

## Recent Changes (2026-05-02, session 92 — transfer-system overhaul + Invoice Review tab + client inline edits)

Session focused on closing out long-running transfer-related bug classes, enabling client-portal users to tag their own inventory, and replacing the Invoice Review stub with a real management view.

### Transfer system overhaul (steps 1–3)

Audit found the duplicate-row-per-tenant data model (every transferred item lives as a `Transferred` row under the source tenant + an `Active` row under the destination, sharing the same `item_id`) was the root cause of multiple recurring symptoms — Access Denied on detail pages, photos invisible to the new owner, notes orphaned, will-calls stale on the source. Three-layered fix landed together.

- **Step 1 — `inventory_live` view + React rewire.** New `public.inventory_live` (security_invoker=true, excludes `status='Transferred'`). `fetchItemByIdFromSupabase` now reads from the view so the historical row can never reach the detail page. Tenant-scope param kept as defense in depth. `src/lib/supabaseQueries.ts`, `src/hooks/useItemDetail.ts`.
- **Step 2 — GAS auxiliary-table migrations.** New `api_postTransferSupabaseSideEffects_` runs after `fullClientSync` inside the `transferItems` case handler. Migrates `entity_notes` (inventory-anchored) + `item_photos` rows from source tenant to destination, strips transferred items from any open `will_calls` on the source tenant (cancels the WC if its `item_ids` becomes empty). Storage RLS `photos_select_tenant` extended with a row-based OR clause so photos remain readable to the new tenant without physically moving objects. New `supabasePatch_` + `supabaseSelect_` helpers in `StrideAPI.gs`.
- **Step 3 — Provenance columns.** `inventory.transferred_from_tenant_id` (text) + `transferred_at` (timestamptz), indexed. Stamped during step 2. Backfilled across **31 historical transfer pairs** in one DDL migration so notes / photos / provenance are correct for items already transferred (including 62596, 62632 confirmed for Nip Tuck Remodeling).
- StrideAPI.gs v38.145.0, Web App v435. Migrations: `inventory_live_view_and_transfer_provenance`, `photos_storage_rls_via_item_photos_tenant`, `backfill_transferred_item_aux_tables`.

### Invoice Review tab — real implementation (replaces empty stub)

Tab was bound to `useState<InvoiceReviewRow[]>([])` and never fetched anything — pure stub. Replaced with a full invoice management view in `src/pages/Billing.tsx`:

- **Read** Supabase-only: `billing` where `status IN ('Invoiced','Void') AND invoice_no IS NOT NULL`. RLS scopes for clients automatically. No GAS round-trip for the list.
- **Group** by `invoice_no` into a summary list — client, invoice date, total $, line count, status badge, expand/collapse arrow. "Mixed" badge surfaces partial voids.
- **Search** invoice #, client, item descriptions, item IDs.
- **Filter** client dropdown, status (Invoiced/Void/All), invoice-date range, Clear button.
- **Sort** Invoice #, Client, Invoice Date, Total — click header to toggle.
- **Expand** to show all line items with svc badge, item DeepLink, description, qty/rate/total, refs to Task / Repair / Shipment (DeepLinks each), notes.
- **Per-invoice actions:** PDF (opens `invoice_url` in new tab), Void (staff/admin only, optimistic update with revert-on-failure, custom `loadingText="Voiding…"` / `successText="Voided"` on WriteButton).
- **Realtime:** subscribes to `entityEvents` so billing writes refresh the list automatically.

New API + GAS: `postVoidInvoice` in `src/lib/api.ts`; `handleVoidInvoice_` + case route in `StrideAPI.gs` (withStaffGuard + withClientIsolation, fullClientSync after, audit row written). Sets every Billing_Ledger row matching `invoiceNo` to `Void`, appends a "Voided: <reason>" note.

### Client-role inline edit on Inventory (Room + Reference)

Added `canEditClientFields` predicate in `src/pages/Inventory.tsx` admitting `role==='client'` for the Room and Reference cells only. Operational fields (vendor, sidemark, description, location) stay admin/staff-only via the existing `canEditInventory` check. Critically the columns `useMemo` deps array also gained `canEditClientFields` — without it, the cells stayed disabled forever because the only deps signal (`canEditInventory`) doesn't change for client users.

### ItemDetailPanel save → list refresh latency fix

`ItemDetailPanel`'s two save handlers (field edits + coverage edits) called `postUpdateInventoryItem` but never fired `entityEvents.emit('inventory', itemId)`. Other consumers (`useInventory`, `BatchDataContext`) only learned about the change via the Supabase realtime echo, which lags the GAS write by several seconds. Easy to navigate back to the list before that lands and see stale values until manual refresh. Added the missing emit on both paths to match the `InlineEditableCell` pattern.

### Inventory I/A/R/W/D badges — failed-inspection red I + uniform sizing

`ItemIdBadges` gained a third `state` ('open'/'done'/'failed') for the I badge. When an INSP task is Completed with `result='Fail'`, the badge renders `#DC2626` with `fontWeight: 900` instead of green/orange. Plumbed through `useItemIndicators` (now also pulls `result` from tasks) and every consumer (Inventory, Tasks, Repairs, Dashboard pages + Item / Task / Repair / Shipment / Will Call detail panels). Also fixed thin-letter sizing — all five badges now sit in a fixed `minWidth: 12px` square with centered text so the strip reads uniform regardless of letter width.

### Item access check — parent clients unblocked, transferred items resolve to live row

`useItemDetail`'s access check compared `result.clientSheetId` against `user.clientSheetId` (single primary tenant), so parent-client accounts with multiple accessible tenants hit Access Denied on child-tenant items even though the rest of the app showed them. Switched to `user.accessibleClientSheetIds.includes(...)` matching every other detail hook's `hasAccess()` helper. Combined with the inventory_live view fix, this resolves the Hillary / Nip Tuck case fully.

### Other small fixes

- **Delivery Orders impersonation:** `useOrders` removed `isSupabaseCacheAvailable()` gate (which returns false during impersonation, surfacing a misleading "Supabase connection unavailable" error). Page is Supabase-only by design; RLS handles tenant scoping.
- **CreateDeliveryOrderModal client picker:** filters to `user.accessibleClientNames` for non-staff and shows a read-only label when there's a single accessible client. Staff/admin keep the full list.
- **Client filter dropdown leak:** Inventory / Tasks / Repairs / WillCalls / Shipments / Orders pages stopped showing "51 selected" to client-role users. ONE-TIME ref-guarded init: client role always force-overwrites `clientFilter` to `accessibleClientNames` on mount; staff/admin only auto-fill if empty so subsequent narrowing/clearing sticks.

### Memory / docs

- Updated `feedback_run_deployments.md` with explicit GAS deploy commands (`npm run push-api && npm run deploy-api`) so future sessions don't tell users to paste — landed because I made that mistake mid-session.

---

## Recent Changes (2026-05-02, session 91 — perf sweep + worktree convention + billing-page audit close)

Late-day session that started as a single production fire (release-items timing out on multi-item orders) and turned into a full sweep of the per-cell `setValue`-in-loop antipattern across the GAS surface, plus closing out the billing-page audit's final follow-up. Two HEAD-stomp incidents from parallel-builder collisions in the canonical clone forced a process change: per-builder git worktrees, documented as a Critical Rule.

### PR #186 — handleReleaseItems_ bulk-write
- Production fire: releasing items on a 50+ item order was hitting GAS execution timeout (3 setValue() per item × 50 items × 500ms-2s/round-trip = 3-5 min). Refactored to collect all per-row mutations into in-memory arrays, compute the contiguous range covering changed rows, and write each affected column ONCE via `setValues`. Untouched-but-in-slice rows write back snapshot values so unrelated data isn't clobbered.
- 50-item release: ~3-5 min → <5 sec. Constant time regardless of item count.
- StrideAPI.gs v38.142.8, Web App v425.

### PR #187 — handleCreateInvoice_ ledger updates bulk-write
- Same antipattern in `api_markClientLedgerInvoiced_` + Email Status updates on Consolidated_Ledger inside `handleCreateInvoice_`. Up to 4 setValue() per ledger row × N rows on a monthly invoice (~200 lines = 800 round-trips, frequent timeouts).
- New code: 4 round-trips for client Billing_Ledger update + 1 for Consolidated_Ledger Email Status, regardless of N. StrideAPI.gs v38.142.9, Web App v426.

### PR #188 — handleCancelWillCall_ bulk-write (Class A)
- Smaller-scale variant — cancellation set 1 setValue per WC_Items row in a loop. 20-item WC = 1-2 min hang (not a timeout; users assumed click hadn't registered). Same recipe applied to the WC_Items Status column. Note: `wciData` here uses `getDataRange()` so includes the header at index 0 — sheet row R maps to `wciData[R-1]` (vs PR #186's wciData sliced from row 2). Captured inline.
- StrideAPI.gs v38.142.10, Web App v427.

### PR #190 — api_writeThrough_ batch path (Supabase mirror)
- Audit revealed every bulk handler also called `api_writeThrough_` afterward to mirror to Supabase, and that path was per-row: each ID = `SpreadsheetApp.openById` + `sheetToObjects_(sheet)` + linear scan + single-row `supabaseUpsert_` POST. So 50-item release-items had ~10-25 sec of writeThrough on top of the (already-fixed) sheet write.
- New `resyncEntitiesBatchToSupabase_` opens the sheet ONCE, reads `sheetToObjects_` ONCE, builds an id→row map, constructs all upsert objects in memory (using the same `sb*Row_` helpers `api_fullClientSync_` uses), and fires a single `supabaseBatchUpsert_(table, rows)`. That helper already chunks at 50 + retries per-row on chunk failure, so robustness for big batches is inherited.
- `api_writeThrough_` dispatches to the batch path when `ids.length > 1 && entityType !== "clients"`. Single-ID router cases (~25 sites) unchanged. On batch failure, falls back to the existing per-row loop so `gs_sync_events` still gets per-entity failure rows for the React FailedOperationsDrawer.
- Updated 4 batch handlers (`handleBatchCancelTasks_`, `handleBatchCancelRepairs_`, `handleBatchCancelWillCalls_`, `handleBatchReassignTasks_`) to pass `succeededIds` as an array. `handleReleaseItems_` already passed an array — picks up the batched path automatically.
- 50-item release writeThrough: ~10-25 sec → ~0.5-1 sec. batch-cancel-20-tasks: ~4-10 sec → ~0.5 sec.
- StrideAPI.gs v38.142.11, Web App v428.

### PR #191 — Class C handlers bulk-write
- `handleStartTask_`, `handleCompleteTask_`, `handleCompleteRepair_` were each doing 4-8 separate setValue() calls per request (one row across many columns) — 5-15 sec of latency. Sluggish enough that staff thought clicks weren't registering and clicked again.
- Refactored each: read full row once at function start (already happening), replace each `setValue` with `setRowVal_(col, val)` that mutates the in-memory rowData and tracks modified columns, then single `setValues` over the contiguous slice at end-of-try. Untouched-but-in-slice columns write back existing values from the snapshot.
- Also dropped a now-redundant `SpreadsheetApp.flush()` inside `handleCompleteTask_`'s Custom Price branch (the bulk write at end-of-try makes it meaningless; `resyncEntityToSupabase_` flushes itself before reading). `handleCompleteRepair_`'s `Email Sent At` setValue stays standalone — fires AFTER lock release in a separate control flow, doesn't multiply.
- Each handler now responds in <2 sec. StrideAPI.gs v38.142.12, Web App v429.

### PR #194 — handleBatchCancelWillCalls_ cascade fix + handleCancelWillCall_ duplicate-read cleanup
- Two cleanups picked from PR #188's "out of scope" list. (1) The bulk-cancel handler was re-reading the WC_Items snapshot inside its outer WC loop AND writing one setValue per cascaded item — for M WCs × N items, M reads + M·N round-trips. 5-WC × 20-item bulk cancel was ~60-180 sec. New code reads `wciData` ONCE before the outer loop, accumulates cancel-row sheet numbers across all WCs into `wciCancelRows`, single bulk setValues over the contiguous range at the end. Index-math note: this `wciData` is sliced from row 2 (no header), so sheet row R maps to `wciData[R - 2]` (differs from #188's `getDataRange()` form).
- (2) `handleCancelWillCall_`'s section-5 email-table builder no longer re-reads the sheet into `wciMap2`/`wciData2` — reuses the section-4 `wciMap`/`wciData` snapshot. Item-level fields don't change with cancellation, so the pre-write snapshot is identical for the email table (which only reads Item ID, Qty, Vendor, Description, Sidemark — not Status).
- StrideAPI.gs v38.143.1, Web App v431. (v38.143.0 was the parallel-shipped PR #193 task add-ons; my will-call cleanup landed on top as a patch bump.)

### PR #197 — per-builder worktree convention (chore/docs)
- Two HEAD-stomp incidents this session: builder A ran `git checkout -b ...` to start work, builder B then ran `git checkout ...` for theirs in the same canonical clone, A's next commit landed on B's branch because both shared one HEAD. Recovered by cherry-picking onto the right branch each time, but the second occurrence was while shipping THIS very PR — strong evidence the convention is needed.
- Added "⚠️ CRITICAL: Worktrees for parallel builders" section to CLAUDE.md (and stride-gs-app/CLAUDE.md mirror). Convention: `git worktree add -b fix/<scope>/<desc> /c/dev/stride-<topic> source` per session. Each worktree has its own HEAD/index/working-tree, shared `.git`. Git enforces "one worktree per branch," so collisions become physically impossible. Documented session-end cleanup (`git worktree remove`), npm-install requirement (`node_modules` not shared), and the existing "Never deploy from a worktree without merging to source first" rule (worktrees are for *building* in parallel; canonical clone is for *deploying* the merged result).

### PR #200 — Billing Category filter (closes billing-page audit PR 3)
- Added a `Category` MultiSelectFilter between Sidemark and Service on the Billing → Report tab. Categories derive from `useServiceCatalog` (already swapped from `usePricing` in #185 / audit PR 2). Selecting categories reactively narrows the Service dropdown via `SVC_OPTIONS_FOR_FILTER`. A `useEffect` drops service selections that fall out of view when categories change (no ghost selections hiding behind a category narrow).
- `BillingFilterParams.categoryFilter?: string[]` flows through both the Supabase path (`fetchBillingFromSupabaseFiltered` adds `.in('category', filters.categoryFilter)`) and the GAS path (URL param; handler may ignore — Supabase is primary read for billing). `billing.category` is already populated on every write, so no migration.
- Closes the billing-page audit's last open follow-up. PR 1 (seed INSURANCE) shipped in #183, PR 2 (services from Supabase) in #185, PR 3 (this one) in #200.

### Parallel work (other builders, same day)
- PR #185 — services filter from Supabase (audit PR 2). PR #189 — storage charges Postgres RPC + GAS commit-rows write-only (progress on long-term step 5 of the migration plan). PR #192 — respect `client.separate_by_sidemark` on invoice grouping (was always splitting). PRs #193 + #195 — billable task add-on services (`task_addons` table + AddTaskServiceModal + completion flow folds addon rows into Billing_Ledger). PRs #196 + #198 + #199 — BillingPreviewCard / BillingCalculator port from WMS (collapsible preview card + footer pill alignment + task-billing consolidation).

---

## Recent Changes (2026-05-02, session 90 — GAS→Supabase email migration batch)

### PR #174 — notify-new-order + notify-public-request route through send-email
- Both edge functions previously POSTed rendered HTML to GAS sendRawEmail. They now hand off to the `send-email` edge function (Resend) — drops `GAS_API_URL` / `GAS_API_TOKEN` deps, gets idempotency + `email_sends` audit rows for free.
- Idempotency keys: `order-review-request:<id>`, `public-request-confirm:<id>`, `public-request-alert:<id>`. Re-fires on the same order are deduped.
- Files: `stride-gs-app/supabase/functions/notify-new-order/index.ts`, `stride-gs-app/supabase/functions/notify-public-request/index.ts`. Deployed v8 / v3.

### PR #175 — ONBOARDING_EMAIL resend off GAS via send-onboarding-email
- New edge function `stride-gs-app/supabase/functions/send-onboarding-email/index.ts` (v1) resolves user → client (via `cb_users` + `clients`) → tokens → `send-email`. Replaces the GAS `sendOnboardingToUsers` path.
- Settings → Users → Resend Onboarding now calls the new function. Removed `postSendOnboardingToUsers` import from `Settings.tsx`.
- The GAS handler stays alive for activation / password-reset (those issue temp passwords + need the credentials-block fallback).

### PR #176 — CLAIM_STAFF_NOTIFY off GAS via React-side send-email
- `CreateClaimModal.tsx` now fires `sendEmail({ templateKey: 'CLAIM_STAFF_NOTIFY', tokens, idempotencyKey })` after `postCreateClaim` succeeds. Recipients resolve from `email_templates.recipients` (`{{STAFF_EMAILS}}`).
- `handleCreateClaim_` in StrideAPI.gs (v38.119.0) no longer sends CLAIM_STAFF_NOTIFY — keeping it would double-send. CLAIM_RECEIVED to claimant still on GAS for now.
- Deployed: GAS push + deploy-api (Web App v422), then React `npm run deploy`.

### PR #178 — claim status emails (CLAIM_RECEIVED + CLAIM_MORE_INFO + CLAIM_DENIAL)
- CreateClaimModal also fires CLAIM_RECEIVED to the claimant after postCreateClaim. ClaimDetailPanel fires CLAIM_MORE_INFO after postRequestMoreInfo and CLAIM_DENIAL after postSendClaimDenial. All three GAS-side sends stripped (StrideAPI.gs v38.120.0). Web App v423.
- CLAIM_SETTLEMENT stays on GAS — needs attachments (now landed in PR #182) AND the PDF source moved off Drive.

### PR #179 — notify-order-revision routes through send-email
- ORDER_REJECTED + ORDER_REVISION_REQUESTED no longer POST to GAS sendRawEmail. Edge function v3 ACTIVE; idempotency `${action}:${orderId}`.

### PR #180 — ACCOUNT_REFRESH_INVITATION off GAS
- Settings → Clients → Send Refresh Link now hits send-email with templateKey ACCOUNT_REFRESH_INVITATION. Same modal-edit override pattern as PR #169.

### PR #181 — cleanup: dead GAS handlers + React wrappers
- ~383 lines retired across StrideAPI.gs + api.ts. Handlers: sendIntakeInvitation, notifyIntakeSubmitted, sendOnboardingToUsers, emailSignedAgreement (all migrated earlier in the session). StrideAPI.gs v38.121.0, Web App v424.

### PR #182 — send-email attachments support
- Optional `attachments` array forwarded 1:1 to Resend (each item = `{filename, content (base64) | path (URL), contentType?}`). React wrapper (`src/lib/email.ts`) gets matching types. Edge function v5 ACTIVE.
- Unblocks INSP_EMAIL + CLAIM_SETTLEMENT migrations (each still needs the PDF source moved off Drive before they can ship).

---

## Recent Changes (2026-05-01, session 87)

### Email CTA &client= precedence + fetcher fallback (real fix for "Task Not Found")
- Symptom (after [#156](https://github.com/Stride-dotcom/Stride-GS-app/pull/156), [#159](https://github.com/Stride-dotcom/Stride-GS-app/pull/159), [#160](https://github.com/Stride-dotcom/Stride-GS-app/pull/160) had landed): inspection email CTA still landed on "Task Not Found" for INSP-62945-1 (Vida-Merit) and INSP-63026-1 (Vida-Waymark). Hard-refresh didn't help.
- Real cause: `api_sendTemplateEmail_` in StrideAPI.gs built the `&client=` suffix from `settings["CLIENT_SPREADSHEET_ID"]` first and the explicit `clientSheetId` param last. Older client sheets don't have that setting populated, so the suffix came out empty → auto-injected "Open in Stride Hub" CTA shipped without a tenant. The frontend fetcher then ran with no `&client=` and the unscoped path (which already existed) failed because the row was visible only after admin RLS bypass — but the legacy GAS fallback also didn't resolve.
- Fix server: reorder precedence so the authoritative `clientSheetId` param wins. Plus a final safety net that re-checks the chosen `ctaUrl` and appends `&client=` if it slipped through. StrideAPI.gs v38.142.7. Pushed + deployed (Web App v421).
- Fix frontend: `fetchTaskByIdFromSupabase` — scoped lookup miss now falls through to unscoped fetch; when multiple rows match unscoped and we have a hint, prefer the matching tenant. Stale / wrong / missing `&client=` on old emails no longer dead-end. PR #162.

### Auth: block authenticated transition until JWT carries user_metadata
- Symptom: even with the correct deep-link format, clicking an inspection email cold (e.g. INSP-63026-1) sometimes lands on "Task Not Found"; a manual refresh fixes it.
- Root cause: `AuthContext` fired `supabase.auth.updateUser({role, clientSheetId})` fire-and-forget and immediately marked the user authenticated. The first `useTaskDetail → fetchTaskByIdFromSupabase` query could race a stale JWT whose `user_metadata` lacked role/clientSheetId. The `tasks_select_staff` RLS bypass keys off `user_metadata.role`; with that missing even admin lookups returned 0 rows → "not-found".
- Fix: `src/contexts/AuthContext.tsx` — both auth paths (cached fast-path + fresh GAS-verify) compare the live session JWT's `user_metadata` against the resolved user and only `await` `updateUser` when stale. Zero added latency when already in sync. PR #160.

### Email deep-link self-heal + WillCalls query-param fix
- WillCalls.gs (CREATED + RELEASE emails) shipped route-style URLs `/#/will-calls/<id>` with no `&client=`, which the React detail lookup rejects. Switched to `?open=<id>&client=<ssid>` per CLAUDE.md "Deep Links — DO NOT BREAK".
- Emails.gs `sendTemplateEmail_` gains a defensive self-heal that rewrites any leftover `/#/<entity>/<id>` URL (shipments|tasks|repairs|will-calls|inventory|claims) to query-param form with `&client=` before the existing missing-&client= patcher runs. Hand-edited templates can't ship the broken format.
- Investigation context: user reported "Task Not Found" from an INSP_EMAIL CTA for INSP-63026-1 (Vida-Waymark). The link format and the row are both fine; the proximate fix was [#156](https://github.com/Stride-dotcom/Stride-GS-app/pull/156)'s tenant-scoped fetcher (browser hard-refresh required to pick up the new bundle). This PR locks down the broader broken-link class.
- Versions: WillCalls.gs v4.6.1, Emails.gs v4.8.2. PR #159. Rolled out to all 52 clients.

### Photo upload routes to the active source-filter sub-tab
- Symptom: on the item Photos tab, switching the sub-filter to "Repair" and uploading still wrote the photo to the inventory item, not the repair.
- Root cause: `PhotoGallery` hard-coded the upload target to the host entity (`entity_type='inventory'`, `entity_id=item.itemId`); the sub-filter only filtered display.
- Fix: `usePhotos.uploadPhoto` accepts an optional `{entityType, entityId}` override (storage path + `item_photos` row stamp both honor it). `PhotoGallery` resolves the target from the active sub-tab using a new `relatedEntities` prop. Single match → upload routes to that entity; zero / multiple matches → button disabled with a tooltip. `ItemDetailPanel`'s `PhotosPanelProxy` threads `linkedTasks / linkedRepairs / linkedWillCalls / shipmentNumber` into the gallery. `PhotoUploadButton` gains a `disabledReason` tooltip prop. PR #158.

### Storage RLS tolerates `_` ↔ `-` in clientSheetId path prefix
- Symptom: Hillary @ Nip Tuck (client role) couldn't see photos on inventory items in her own account; admin "login as" worked fine.
- Root cause: `usePhotos` / `useDocuments` upload paths sanitize the tenant ID via `sanitizeTenantForPath` (replaces `_` with `-`), but the storage RLS policies (`photos_select_tenant`, `documents_select_tenant`) compared the raw JWT `clientSheetId` (with `_` preserved) against the sanitized path's first segment. Tenants whose ID contains `_` — Nip Tuck (`1_CINtvp...`) and ~10 others — got blocked from their own photos. Admin/staff bypassed via the role branch.
- Fix: `supabase/migrations/20260501010000_storage_rls_underscore_dash_tolerance.sql` — policies now accept either the raw or underscore-stripped form. Verified as Hillary: visible photos bucket objects rose 188 → 280 (+92 for Nip Tuck alone). Migration applied via MCP. PR #157.

### Task detail lookup scoped by tenant — fixes "Task Not Found" after transfer
- Symptom: item 62630 was received under J Garner (auto-inspect), then transferred to Nip Tuck (also auto-inspect). Both tenants ended up with `INSP-62630-1` in their Tasks sheet (J Garner CANCELLED via Transfer.gs, Nip Tuck COMPLETED). Clicking either row showed "Task Not Found".
- Root cause: task IDs are unique per-spreadsheet only (Tasks.gs `nextTaskCounter_` scans the local sheet). After transfer, both tenants hold rows with the same `task_id`. The detail fetch used `.eq('task_id', taskId).maybeSingle()`, which fails on duplicates.
- Fix: `src/lib/supabaseQueries.ts` — `fetchTaskByIdFromSupabase` accepts an optional `clientSheetId` and adds `.eq('tenant_id', clientSheetId)` to disambiguate. With no hint, returns null on multi-row matches so `useTaskDetail`'s legacy GAS scan can resolve.
- Nav plumbing: `src/pages/Tasks.tsx` row click, Task ID cell click, `__openTaskDetail`, `?open=` deep-link effect, and pending-open effect all now append `?client=<spreadsheetId>`. `src/pages/ItemPage.tsx` cross-link to tasks adds it. `src/pages/TaskPage.tsx` and `src/pages/TaskJobPage.tsx` parse `?client=` from URL and pass to `useTaskDetail` (new optional second arg). PR #156.

---

## Recent Changes (2026-04-30, session 86)

### Task ID always clickable on Tasks page
- `src/pages/Tasks.tsx` — Task ID column previously rendered as an orange Drive folder link only when `taskFolderUrl` was set, otherwise greyed-out unclickable text. Now always renders as an orange clickable link that navigates to `/tasks/${taskId}` (the in-app detail page). The Drive folder URL was legacy and shouldn't have gated clickability. `cols()` takes `navigate` parameter; useMemo deps updated to `[navigate]`. Repairs.tsx and WillCalls.tsx checked — neither uses the Drive-folder gating pattern, no changes needed. PR #145.

---

## Recent Changes (2026-04-30, session 85)

### Client access to delivery orders restored
- `src/pages/Orders.tsx` — clients with `RoleGuard`-allowed access to `/orders` couldn't actually see the Orders tab or the "+ New Delivery" button. Three gates were hardcoded `isAdmin` only: tab default, URL→tab resolver, and tab-content render. Replaced with `canViewOrders = isAdmin || isClient`. DT Sync button kept admin-only. Existing client-name filter (lines 162-171) already restricts visible rows to `accessibleClientNames`, so no extra RLS work was needed.

---

## Recent Changes (2026-04-30, session 84)

### Customizable add-on charges on delivery orders
- `src/components/shared/CreateDeliveryOrderModal.tsx` v5 — every selected add-on now exposes editable Qty + Rate inputs in both the entry screen and the Full Edit screen (same component, used in both contexts). Subtotal recomputes live as qty × rate for ALL units (previously `flat`/`plus_base` ignored qty so a flat $185 Disposal could only ever be one line of $185). Rate defaults to the catalog price; staff/admin can override; clients see rate locked but can still change qty. A "Modified" badge surfaces overrides to reviewers. Quote-required add-ons stay at $0/"Quote Required" until staff enters a rate, at which point they become a normal charge. Per-order rate persists in `dt_orders.accessorials_json[].rate` (column already existed; previously the catalog rate was re-looked-up at save time, overwriting any future override).

---

## Recent Changes (2026-04-26, session 83)

### Order revision/rejection emails
- New Edge Function `notify-order-revision` — sends `ORDER_REVISION_REQUESTED` or `ORDER_REJECTED` email when a reviewer flags an order. Recipients = office distro (NOTIFICATION_EMAILS secret) + the order submitter (resolved from `dt_orders.created_by_user` → `profiles.email`), deduped case-insensitively. Mirrors `notify-new-order`'s pattern (template lookup → token substitution → GAS sendRawEmail). Token values are HTML-escaped before substitution.
- Migration `20260426000000_order_revision_email_templates.sql` seeds two new `email_templates` rows. Both visually mirror `ORDER_REVIEW_REQUEST` (dark header, accent banner, detail table, footer) with action-specific colors: amber `#F59E0B` for revisions, red `#DC2626` for rejection. Editable in Settings → Email Templates the same as the rest.
- `src/pages/OrderPage.tsx` — added "Request Revision" button next to existing "Reject". Both prompt for notes via `window.prompt`, persist `review_status + review_notes + reviewed_by + reviewed_at`, then invoke `notify-order-revision` (best-effort — failures log warn but don't unwind the status change).

### dt-sync-statuses bug fix (v8)
- Filter switched from `dt_dispatch_id IS NOT NULL` to `pushed_to_dt_at IS NOT NULL`. App-pushed orders never get a dispatch ID (DT's `add_order` response is just `<success>...</success>`), so the old filter skipped them — they stayed "Awaiting DT Sync" forever. Lookup now passes `dt_identifier` to DT's `service_order_id` query param (which the XML spec confirms accepts the human Order_Number). Falls back to `dt_dispatch_id` for legacy webhook-imported rows.

## Recent Changes (2026-04-25, session 82)

### DT order Completion view + sync-back
- New migration `20260425230000_dt_sync_back_fields.sql` — adds completion columns to `dt_orders` (`started_at`, `finished_at`, `scheduled_at`, `driver_id`, `driver_name`, `truck_id`, `truck_name`, `service_unit`, `stop_number`, `actual_service_time_minutes`, `payment_collected`, `payment_notes`, `cod_amount`, `signature_captured_at`, `dt_status_code`, `dt_export_payload`); per-item delivery state to `dt_order_items` (`delivered`, `item_note`, `checked_quantity`, `location`, `return_codes`, `last_synced_at`); `lat`/`lng`/`source` on `dt_order_history`; allows `source='dt_export'` on `dt_order_notes`. Applied via MCP.
- `dt-push-order` **v15** — driver-facing `<notes>` block falls back to `dt_orders.details` when `order_notes` is empty so the modal's "Notes / Special Instructions" reaches the DT driver app's notes pane.
- `dt-sync-statuses` **v7** — replaced code-only `get_order_status` with `/orders/api/export.xml?service_order_id=…`. Mirrors back driver, truck, started/finished/scheduled, COD/payment, signature timestamp, per-item `delivered_quantity`/`item_note`/`return_codes`, full `order_history` timeline, and DT-side notes. Replace-on-sync scoped to `source='dt_export'` so app/webhook-authored rows survive.
- New `src/pages/OrderPage.tsx` **Completion tab** — renders driver/vehicle, timing (scheduled/started/finished/actual), proof-of-delivery (COD, signature_captured_at), DT-side notes feed, and driver-activity timeline (with Google Maps lat/lng deep-link). Items tab now shows "Delivered" / "Short" badges, driver-posted item notes, and return codes.
- New helpers in `src/lib/supabaseQueries.ts` — `fetchDtOrderHistory(dtOrderId)` and `fetchDtOrderNotes(dtOrderId)` returning `DtOrderHistoryEvent[]` / `DtSideNote[]`. Type extensions on `DtOrderForUI` + `DtOrderItemForUI` for the new sync-back columns.
- **Pending**: photo sync. DT XML export does not return photo URLs; the JSON Beetrack API (`GET /api/external/v1/dispatches/:identifier`) does, under `form.img_url[]`. Needs a separate `X-AUTH-TOKEN` from DT support before wiring.

## Recent Changes (2026-04-25, session 80)

### Scroll position restored on back-navigation
- New `src/hooks/useScrollRestoration.ts` — saves a scrollable container's `scrollTop` to `sessionStorage` (per-page key) on scroll (rAF-throttled). Restores once `isReady` flips true so the virtualizer has measured the full content height. Wired into all 5 list pages (Inventory / Tasks / Repairs / WillCalls / Shipments). Closes the loop on back-nav: dropdown + filters + sort + scroll position all restore.

### Client dropdown persists across navigation
- New `src/hooks/useClientFilterPersisted.ts` — drop-in replacement for `useState<string[]>([])` that persists each list page's client dropdown selection. Initial state precedence: URL `?client=` (resolved via apiClients, wins for email deep-links) → localStorage `stride_client_filter_<pageKey>` (last-used scope) → empty array (falls through to the page's role-default effect). Writes to localStorage on every change.
- Wired into all 5 list pages: Inventory / Tasks / Repairs / WillCalls / Shipments. Fixes the "click into an entity, hit back, dropdown is reset to all clients" pain. Sort + status filter + column visibility were already persisted via `useTablePreferences`; this closes the gap on the dropdown that was still useState-only.

### Back-button restores tab state across Orders / Settings / Billing
- New `src/hooks/useUrlState.ts` — single-key URL search-param state hook built on `useSearchParams`. `[value, setValue] = useUrlState(key, default, { replace? })`. Default pushes a history entry; `replace: true` for transient state. Empty string deletes the param so URLs stay short.
- `src/pages/Orders.tsx`, `src/pages/Billing.tsx`, `src/pages/Settings.tsx` — `activeTab` now lives in the URL via `useUrlState('tab', defaultTab)`. Settings also moves its `clientsSubTab` into `?subtab=`. Switching tabs pushes a history entry; back navigates to the prior tab. Email deep-links (`?tab=clients&subtab=intakes&intake=<id>`) survive subsequent navigation.
- The five list pages (Inventory/Tasks/Repairs/WillCalls/Shipments) didn't need conversion because they already moved to standalone `/inventory/:id`-style routes — back-button handles those natively.

### dt-push-order STRIDE LOGISTICS default fallback
- `supabase/functions/dt-push-order/index.ts` — `resolveAccountName()` now returns `'STRIDE LOGISTICS'` when `acctMap[tenantId]` is empty/missing (was: returned `''` and the caller errored 400). Pushes never fail for unmapped tenants; orders land on the house account and ops can reassign in DT's UI. The caller's `if (!accountName)` early-return is now unreachable but kept for defense in depth.

### Intake notification trigger — defensive EXCEPTION wrapper
- New migration `20260425200000_intake_notification_trigger_safe.sql` — wraps the INSERT inside `notify_admins_on_intake_submit()` in `BEGIN/EXCEPTION WHEN OTHERS` so a notification failure cannot roll back the parent intake transaction. Today the trigger is owned by `postgres` (BYPASSRLS) so the unsafe version works fine, but a future RLS/constraint change won't silently drop intake rows. Notification becomes best-effort; intake row always lands.

### Dropbox-corruption signpost
- New `CLAUDE.md` at the Dropbox repo root (Dropbox-only file, gitignored locally) — directs any future Claude session that lands at the Dropbox path to switch to `C:\dev\Stride-GS-app`. Today's session burned ~30 min recovering git pack corruption that was caused by editing through Dropbox sync; the signpost prevents recurrence.

---

## Recent Changes (2026-04-24, prior session)

### Unified order status + edge function repairs (2026-04-24)
- Migration `20260425020000_unified_order_status.sql` — expanded dt_statuses with 7 new statuses (pending_review, rejected, push_failed, in_transit, billing_review, in_ledger, collected), updated display_order, added push_error column
- `dt-push-order` v13 — added `<custom_field_2>` deep link to DT XML payload (`supabase/functions/dt-push-order/index.ts`)
- `dt-webhook-ingest` v3 — corrected status ID mapping, added auto-Collected logic with error handling, error handling on quarantine/mark-processed (`supabase/functions/dt-webhook-ingest/index.ts`)
- `dt-sync-statuses` v4 — added exception+billing to terminal filter, paid_at in SELECT, same-status guard, auto-Collected logic (`supabase/functions/dt-sync-statuses/index.ts`)
- Created CODE_MAP.md — comprehensive feature-to-file index for builder onboarding
- Added doc update instructions to CLAUDE.md

### Stax + QBO catalog sync
- New Edge Function `stax-catalog-sync` deployed — syncs service_catalog items to Stax on create/update
- QBO sync via Apps Script `handleQboSyncCatalogItem_` — creates/updates QBO Service items
- `stax_item_id` and `qb_item_id` columns added to service_catalog (migration applied)
- Auto-sync wired into `useServiceCatalog` create/update callbacks (non-blocking, best-effort)

### Drive folder URL fix
- Fixed `api_fullClientSync_` to read RichText hyperlinks from Shipment # column
- StrideAPI.gs v38.118.0, deployed as version 387
- Backfill function `backfillShipmentFolderUrls()` ready to run from Apps Script editor

### Delivery access control + admin auto-push
- Delivery page removed from staff navigation (sidebar + route guard)
- "Create Delivery" button and FAB action hidden for staff role (desktop toolbar + mobile FAB)
- Admin-created delivery orders skip review queue — save as "approved" and auto-push to DT
- Delivery audit log entries written for inventory items included in delivery orders
- INSERT policy added to entity_audit_log for admin/staff

---

## Pending User Actions

- [ ] **Get DT JSON-API X-AUTH-TOKEN** (Settings → Advanced Settings in DT, or email support@dispatchtrack.com) so the next session can wire photo sync via `/api/external/v1/dispatches/:identifier`. Add to a new `dt_credentials.rest_api_token` column.
- [ ] Set `STAX_API_KEY` secret on stax-catalog-sync Edge Function in Supabase dashboard
- [ ] Run `backfillShipmentFolderUrls()` from Apps Script editor (one-time)
- [ ] Run `backfillActivityAllClientsNow()` for historical activity log seeding
- [ ] Run `reconcileAllClientsNow` for mirror column backfill
- [ ] Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Stax Auto Pay project Script Properties
- [ ] Run `seedAllStaxToSupabase()` once from Stride API editor (Payments cache seed)
