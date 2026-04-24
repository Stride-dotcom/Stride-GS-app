# GS Inventory — Current Build Status

> **Start here.** One-screen overview for any new builder picking up this project.
> Last updated: 2026-04-03 — Supabase Phase 1 + Phase 2 complete. Phase 3 (read cache) is next.

---

## Live App

| | |
|---|---|
| **URL** | https://www.mystridehub.com |
| **Repo** | https://github.com/Stride-dotcom/Stride-GS-app |
| **Backend** | StrideAPI.gs (Google Apps Script Web App) |

---

## Performance Track — All Phases Complete ✅

| Phase | Status | Commit / Version | What Was Built |
|-------|--------|-----------------|----------------|
| **Phase 1** | ✅ COMPLETE | v33.1.0 | Cache invalidation fix, silent refresh, loading flash fix, reactive detail panels |
| **Phase 2A** | ✅ COMPLETE | v33.2.0, API v113 | Single-client page loading for staff, ClientSelector on entity pages, getBatchSummary endpoint |
| **Phase 2B** | ✅ COMPLETE | `69d4405` | Tabbed Dashboard (Tasks/Repairs/WCs), 10s polling, row-click navigation, stat cards |
| **Phase 2C** | ✅ COMPLETE | `7328b56` | Optimistic UI — status changes, field edits, and create operations |

---

## Supabase Integration — Next Active Workstream

**Status: APPROVED — READY TO BUILD**
Full technical review: `SUPABASE_REALTIME_PLAN_REVIEW.md` (638 lines)
Architecture decision in: root `CLAUDE.md` → "SUPABASE REALTIME INTEGRATION — BUILD PLAN"

| Phase | Status | What Gets Built |
|-------|--------|-----------------|
| **Phase 1** | ✅ COMPLETE (2026-04-03) | Failure visibility + retry: `gs_sync_events` table, RLS, `request_id` in `apiPost()`, React writes `sync_failed` on error/timeout, `FailedOperationsDrawer`, 90s watchdog, badge count |
| **Phase 2** | ✅ COMPLETE (2026-04-03) | Apps Script → Supabase notifications: `notifySupabaseConfirmed_()` + 14 doPost cases wired; `entityEvents.ts` pub/sub; BatchDataContext + 4 hooks subscribe → targeted refetch. **Manual step:** Justin runs `setupSupabaseProperties_()` once from Apps Script editor |
| **Phase 3** | 🔜 **NEXT** | Full read cache mirror: Supabase tables for all entities, bulk import, write-through on every GAS write, background reconciliation, switch React reads from GAS → Supabase |
| **Phase 4** | ⬜ Not started | Cross-user realtime: Supabase Realtime subscriptions, all users see changes within 1-2s, evaluate Task Board retirement |

**Supabase project:** `https://uqplppugeickmamycpuz.supabase.co`
Currently used for auth only — clean space for new tables.

**Key locked decisions:**
- `tenant_id` = `clientSheetId` everywhere
- Apps Script notifications are best-effort — never block the sheet write
- Retry must check current sheet state before resubmitting
- Billing/invoice/payment excluded from Phase 1
- Staff/admin see all failures; clients see own only

---

## Latest Deployed Versions

| System | Version | Notes |
|--------|---------|-------|
| React app (GitHub Pages) | commit `69d4405` | Phase 2B deployed last |
| StrideAPI.gs | v32.2.0+ | Web App deployment v113 |
| Client inventory scripts | v32.x | All clients via `npm run rollout` |
| Consolidated Billing | v13.x | Via `npm run push-cb` |

---

## What's Working Now

- All 12 pages live with real data (no mock data)
- Dashboard: 3-tab job board, 10s polling, optimistic row updates
- Tasks, Repairs, Will Calls: optimistic status changes (instant UI, rollback on error)
- Inventory: optimistic field edits + create operations
- Role-based access: admin / staff / client nav + route guards
- Mobile responsive across all pages
- Resizable detail panels, Edit/Save mode, column reorder/visibility per user
- Parent/Child account system (v32.0.0)
- Stax Payments fully wired (admin only)
- QR Scanner + Move History
- Billing preview mode (preview before commit)

---

## Open Risks

1. **getBatchSummary cache miss** — opens all N client sheets serially (~44s at 5 clients). Addressed in Supabase Phase 3 (full read cache) and partially by Task Board index approach (see `task-board-research.md`).
2. **Cross-page optimistic creates** — task created from Inventory page doesn't appear on Tasks page table until next 10s poll. By design for Phase 2C; addressed in Supabase Phase 4 (realtime).
3. **Field edit patch TTL** — optimistic field patches expire after 120s. Addressed in Supabase Phase 1 (failure tracking will catch and surface these).
4. **GitHub Pages CDN cache** — after `git push`, CDN can serve stale JS for several minutes. Always hard-refresh (Ctrl+Shift+R) to verify.
5. **No failure visibility** — write failures are only shown to the initiating user and disappear on navigation. **This is the primary motivator for Supabase Phase 1.**

---

## Known Issues (Active)

- Inventory page capped at 100 rows — can't print full client inventory (proposal: "All rows" when filtered to single client)
- 4 doc templates still use HTML import (Receiving, Task WO, Repair WO, Will Call) — margin/width issues
- `populateUnbilledReport_()` in Code.gs.js uses old header names ("Billing Status", "Service Date")
- `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- Parent Transfer Access — parent users can't yet transfer between child accounts (staff-only currently)

---

## Next Recommended Work

1. **Supabase Phase 1 — Failure Visibility + Retry** ← START HERE
   - Create `gs_sync_events` table in Supabase with RLS policies
   - Add `request_id` auto-injection to `apiPost()` in `api.ts`
   - Add `sync_failed` write to error branches in all React write handlers
   - Build `<FailedOperationsDrawer />` with retry + dismiss
   - Add 90s timeout watchdog to all write handlers
   - Add badge count subscription to sidebar
   - Full spec: `SUPABASE_REALTIME_PLAN_REVIEW.md` Section E + H

2. **Production testing** — manual QA with real clients on optimistic UI, especially error rollbacks

3. **Quick CB fixes:** Update `populateUnbilledReport_` and `CB13_addBillingStatusValidation` header names

4. **Small features:**
   - "All rows" page size option for single-client filtered Inventory (print support)
   - Global search expansion (shipments, billing, claims missing fields)
   - Parent Transfer Access (parent users transfer between child accounts)

---

## Deployment Commands

```bash
# React app (from stride-gs-app/):
npm run build
cd dist && git add -A && git commit -m "Deploy: ..." && git push origin main --force

# GAS scripts (from stride-gs-app/../AppScripts/stride-client-inventory/):
npm run rollout          # All client inventory scripts
npm run push-api         # StrideAPI.gs
npm run push-cb          # Consolidated Billing
npm run deploy-all       # Update Web App deployments (clients + API)
```

---

## Key Docs (Read in This Order)

1. **`CURRENT_BUILD_STATUS.md`** (this file) — start here
2. **Root `CLAUDE.md`** — full system reference, rules, architecture, all decisions (includes Supabase build plan)
3. **`SUPABASE_REALTIME_PLAN_REVIEW.md`** — full Supabase integration technical review (638 lines) — read before building Phase 1
4. **`task-board-research.md`** — Task Board as Dashboard index research (alternative to getBatchSummary)
5. **`stride-gs-app/PHASE2_DESIGN_REVIEW.md`** — performance architecture decisions
6. **`PHASE2B_HANDOFF_REPORT.md`** — Dashboard redesign details
7. **`stride-gs-app/PHASE2C_HANDOFF_REPORT.md`** — Optimistic UI details (authoritative copy)
8. **`Docs/Stride_GS_App_Build_Status.md`** — React app feature matrix

---

## What NOT to Use

- `stride-build-instructions` skill — for the **separate** Stride WMS web app (Supabase/SALA/RLS). Does not apply here.
- `stride-wms-domain` skill — same, wrong project.
