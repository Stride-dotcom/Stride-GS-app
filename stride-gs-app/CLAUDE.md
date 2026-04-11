# Stride GS App — React WMS Prototype

> **NOTE:** This is the React app-specific quick reference. The master project
> reference is the root `CLAUDE.md`. For performance track status, see root
> `CLAUDE.md` or `CURRENT_BUILD_STATUS.md`.

> React frontend for the Stride Logistics GS Inventory system. Connects to Google Sheets backend via Apps Script API. This is a transitional app — the full Stride WMS web app (Supabase/React) is being built separately.

**Owner:** Justin — Stride Logistics, Kent WA
**Live:** https://www.mystridehub.com
**Repo:** https://github.com/Stride-dotcom/Stride-GS-app

## IMPORTANT: This is NOT the Stride WMS Web App

Do NOT use these skills — they're for the separate Supabase web app:
- `stride-wms-domain`
- `stride-build-instructions`

This app uses: React + TypeScript + Vite + TanStack Table + Supabase (read cache + DT integration).

## Rules for Claude

- **Read the backend reference** at `../CLAUDE.md` for full GS Inventory architecture, deployment instructions, and script details
- **Read the build status** at `../Docs/Stride_GS_App_Build_Status.md` for what's built, what's next, and locked decisions
- **DROPBOX SYNC WARNING:** This project is in a Dropbox-synced folder. Subagents must be READ-ONLY. Main chat does all file writes.
- **TypeScript build must stay clean** — run `npx tsc --noEmit` to verify no type errors before finishing
- **Never calculate billing in React** — all billing logic stays server-side in Apps Script
- **Use existing components** — check `src/components/shared/` before creating new ones (WriteButton, BatchGuard, ActionTooltip, BatchProgress already exist)
- **Use existing hooks** — check `src/hooks/` before creating new ones
- **Follow the design system** — Stride orange (#E85D2D), Inter font, shadcn-inspired clean aesthetic

## Tech Stack
- **Build:** Vite + React 18 + TypeScript
- **Tables:** TanStack Table v8
- **Icons:** Lucide React
- **Router:** HashRouter (for GitHub Pages SPA compatibility)
- **State:** React hooks + TanStack Query patterns (useApiData)
- **Deploy:** `npm run build` → `cd dist` → `git add -A && git commit -m "msg" && git push origin main --force`

## Key Directories
```
src/
├── components/
│   ├── layout/          ← Sidebar, Header, AppLayout
│   ├── shared/          ← Reusable: WriteButton, BatchGuard, ActionTooltip, Detail Panels
│   └── ui/              ← Base UI primitives
├── hooks/               ← useApiData, useClients, useInventory, useTasks, etc.
├── lib/
│   ├── api.ts           ← apiFetch<T>(), typed API functions
│   └── mockData.ts      ← Mock/demo data (fallback when API unconfigured)
├── pages/               ← Login, Dashboard, Inventory, Tasks, Repairs, WillCalls, Billing, Payments, Claims, Settings, Receiving
└── types/               ← TypeScript type definitions
```

## API Connection
- **Endpoint:** StrideAPI.gs deployed as "Execute as Me, Anyone can access"
- **Auth:** Token via query parameter (`?token=xxx`)
- **Config:** Settings → Integrations → API Connection (URL + token stored in localStorage)
- **Pattern:** `apiFetch<T>(action, params?)` → returns typed data or throws
- **Hooks:** `useApiData(fetchFn)` → `{ data, loading, error, refetch }`

## Supabase

- **Project:** `https://uqplppugeickmamycpuz.supabase.co`
- **Migration files:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`
- **Apply migrations:** via MCP tool `mcp__94cd3688-d1f9-4417-a61a-6e38b1d2b097` (see root `CLAUDE.md` Deploy Reference)
- **Client:** `src/lib/supabase.ts` — anon key in `.env` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **Read queries:** `src/lib/supabaseQueries.ts`

**Applied migrations:**
| Migration | Tables |
|---|---|
| `20260403213925_phase3_read_cache_tables` | inventory, tasks, repairs, will_calls, shipments, billing |
| `20260411120000_dt_phase1a_schema` | dt_statuses, dt_substatuses, dt_orders, dt_order_items, dt_order_history, dt_order_photos, dt_order_notes, dt_webhook_events, dt_credentials, dt_orders_quarantine, audit_log |

**DispatchTrack integration:** Phase 1a schema live. Phase 1b Orders tab live (admin-only, commit `63207c2`). Phase 1c (webhook ingest) is next. Full plan: `../Docs/DT_Integration_Build_Plan.md`.

## Current Status
See `../Docs/Stride_GS_App_Build_Status.md` for full status.

**Current:** Phase 2B, 2C, and DT Phase 1b complete.
- Phase 2B (commit `69d4405`): Tabbed Dashboard, 10s polling, row-click navigation
- Phase 2C (commit `7328b56`): Optimistic UI — all status changes, field edits, creates
- DT Phase 1b (commit `63207c2`): Orders tab — Supabase-backed, admin-only, empty until Phase 1c

**Next:** DispatchTrack Phase 1c (webhook ingest Edge Function). Needs DT API credentials + webhook secret.
