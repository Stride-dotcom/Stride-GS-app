# Supabase Integration — Full Build Plan (Archived)

> **Status as of 2026-04-04:** Phases 1, 2, 3 COMPLETE. Phase 4 (Cross-User Realtime) not yet started.

---

## Architecture decision

- **Google Sheets / Apps Script** = execution authority (writes, billing, email, PDF, Drive)
- **Supabase** = full read cache + realtime coordination + failure tracking layer
- Mirror ALL entity data into Supabase (inventory, tasks, repairs, will calls, shipments, billing)
- React app reads from Supabase (50-100ms) instead of GAS endpoints (3-44s)
- Supabase Realtime pushes changes to all connected users instantly
- Task Board may be retired once Supabase read cache is stable

## Locked decisions

1. Phase 1 = failure tracking + retry only (no success confirmations yet)
2. Staff/admin see all failures across all clients; client users see only their own
3. Failure records persist until manually resolved
4. `tenant_id` = `clientSheetId` (real tenancy boundary)
5. Mirror everything into Supabase (full read cache, not just notifications)
6. Initial bulk import + write-through on every GAS write + background reconciliation
7. 2-3K rows currently, Supabase free tier is sufficient
8. Apps Script → Supabase notification is best-effort, never blocks the sheet write
9. Retry must always check current sheet state before resubmitting
10. Billing/invoice/payment operations excluded from Phase 1

## Supabase project

- URL: `https://uqplppugeickmamycpuz.supabase.co`
- Service role key: stored in StrideAPI.gs Script Properties as `SUPABASE_SERVICE_KEY`

## Tables

### gs_sync_events (Phase 1)
`id uuid, tenant_id (clientSheetId), entity_type, entity_id, action_type, sync_status (pending_sync/confirmed/sync_failed), requested_by, request_id, payload jsonb, error_message nullable, created_at, updated_at, confirmed_at`

### Read cache tables (Phase 3)
`inventory, tasks, repairs, will_calls, shipments, billing`

Each table: full mirror of the client sheet data, RLS-protected (staff/admin read all, clients read own tenant_id only), indexed for fast queries, realtime-enabled.

**2026-04-04: `billing` table got `sidemark text` column added via migration** (StrideAPI.gs v38.6.0) so billing ledger can display sidemark without re-lookup.

---

## Phase 1 — Failure Visibility + Retry ✅ COMPLETE (2026-04-03)

- `gs_sync_events` table created via `supabase-phase1-setup.sql`
- `request_id` generation in `apiPost()` + 90s timeout watchdog
- React writes `sync_failed` events on all write error branches (10 actions across 3 panels)
- FailedOperationsDrawer: slide-in panel, retry/dismiss per row, amber=timeout
- Badge count in Sidebar (AlertCircle with red count pill)
- Staff/admin see all (via user_metadata.role); clients see own only
- Single hook in AppLayout — no duplicate Supabase subscriptions

**Reference doc:** `SUPABASE_PHASE1_HANDOFF_REPORT.md`

---

## Phase 2 — Apps Script → Supabase Notifications ✅ COMPLETE (2026-04-03)

- `setupSupabaseProperties_()` sets `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (run once from editor)
- `notifySupabaseConfirmed_()` / `notifySupabaseFailed_()` / `api_notifySupabase_()` helpers in StrideAPI.gs
- 14 `doPost` cases wired: all task/repair/will_call/inventory write handlers
- `entityEvents.ts` pub/sub emitter (zero React deps) in React app
- `useFailedOperations` emits entity events on confirmed Supabase rows
- `BatchDataContext` subscribes → `silentRefetchBatch` (client users)
- `useTasks` / `useRepairs` / `useWillCalls` / `useInventory` subscribe → `individualRefetch` (staff/admin)
- No duplicate Supabase subscriptions; all reactivity flows through `entityEvents`
- **AUTH BUG FIX:** `USER_UPDATED` guard in AuthContext (commit d7dd2f7)

**Manual step:** Justin must run `setupSupabaseProperties_()` once from Apps Script editor.
**Reference doc:** `SUPABASE_PHASE2_HANDOFF_REPORT.md`

---

## Phase 3 — Supabase Read Cache (Full Mirror) ✅ COMPLETE (2026-04-03)

- 6 Supabase tables created: `inventory`, `tasks`, `repairs`, `will_calls`, `shipments`, `billing`
- RLS policies: staff/admin read all, client users read own `tenant_id` only
- Write-through wired into all 23 `doPost` handlers (best-effort, never blocks)
- `supabaseUpsert_` / `supabaseBatchUpsert_` helpers, `sbXxxRow_` row builders
- `handleBulkSyncToSupabase_` — admin endpoint reads all sheets → batch upserts
- `handleReconcileSupabase_` — admin endpoint compares counts, re-syncs drift
- `supabaseQueries.ts` — React query layer (6 entity fetchers + dashboard summary)
- All 6 entity hooks + `useDashboardSummary` try Supabase first (50ms), GAS fallback (3-44s)
- `postBulkSyncToSupabase` / `postReconcileSupabase` React API functions

**Manual steps:**
1. Run `supabase-phase3-setup.sql` in Supabase SQL Editor (creates 6 cache tables) — if not yet done
2. Trigger `bulkSyncToSupabase` from React admin UI (populates Supabase with existing data)

**Reference doc:** `SUPABASE_PHASE3_HANDOFF_REPORT.md`

---

## Phase 4 — Cross-User Realtime (NOT STARTED)

- Supabase Realtime subscriptions in React
- All users see changes within 1-2 seconds of sheet write completing
- Evaluate Task Board retirement

---

## Open risks

- If GAS write succeeds but Supabase notification fails, other users see stale data until next reconciliation
- If GAS write times out (>30s), `sync_status` stays `pending_sync` — needs watchdog
- Bulk import for new client onboarding must be part of the onboarding workflow
- RLS policies must be verified against actual auth model before any new builds

## Reference docs

- `SUPABASE_REALTIME_PLAN_REVIEW.md` — full technical review (638 lines)
- `SUPABASE_PHASE1_HANDOFF_REPORT.md` — Phase 1 details
- `SUPABASE_PHASE2_HANDOFF_REPORT.md` — Phase 2 details
- `SUPABASE_PHASE3_HANDOFF_REPORT.md` — Phase 3 read cache implementation details
- `stride-gs-app/PHASE2_DESIGN_REVIEW.md` — prior architecture decisions
