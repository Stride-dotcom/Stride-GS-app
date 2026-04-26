# Stride GS App — Builder Instructions

> React frontend for Stride Logistics GS Inventory system. Google Sheets backend via Apps Script API + Supabase read cache + DispatchTrack delivery integration.

**Owner:** Justin — Stride Logistics, Kent WA
**Live:** https://www.mystridehub.com
**Repo:** https://github.com/Stride-dotcom/Stride-GS-app
**Local path:** `C:\dev\Stride-GS-app` (NOT in Dropbox — moved 2026-04-24 to prevent git corruption)
**Supabase:** `uqplppugeickmamycpuz` — `https://uqplppugeickmamycpuz.supabase.co`

## New machine setup

```bash
git clone https://github.com/Stride-dotcom/Stride-GS-app.git C:\dev\Stride-GS-app
cd C:\dev\Stride-GS-app\stride-gs-app && npm install
```

Then copy the 3 gitignored credential files from Dropbox into place:
```
Dropbox\Apps\GS Inventory\credentials\.credentials.json  →  AppScripts\stride-client-inventory\admin\
Dropbox\Apps\GS Inventory\credentials\client_secret.json →  AppScripts\stride-client-inventory\admin\
Dropbox\Apps\GS Inventory\credentials\.sync-config.json  →  AppScripts\stride-client-inventory\admin\
```

Then install AppScripts deps:
```bash
cd C:\dev\Stride-GS-app\AppScripts\stride-client-inventory && npm install
```

---

## Do NOT use these skills

`stride-wms-domain`, `stride-build-instructions` — those are for the separate Stride WMS web app, not this project.

---

## Rules

### Must-do

- **BRANCH FIRST.** `git checkout -b feat/<stream>/<desc>` from `source`. Streams: `feat/warehouse/*`, `feat/delivery/*`, `feat/fix/*`. Use `gh pr create --base source` then `gh pr merge --squash --delete-branch`. Never commit directly to `source`.
- **Deploy AFTER merge.** `git checkout source && git pull origin source` then deploy commands.
- **Deploy before reporting done.** Execute via Bash, don't just describe.
- **TypeScript must stay clean** — run `npx tsc --noEmit` (or `node node_modules/typescript/lib/tsc.js --noEmit`) before finishing.
- **Version header on every `.gs`/`.js` edit.** Patch bump for fixes, minor for features. PST timestamps.
- **Header-based column mapping.** Use `getHeaderMap_()` / `headerMapFromRow_()`. Never positional indexes.
- **Use existing components** — check `src/components/shared/` (60 components) before creating new ones.
- **Use existing hooks** — check `src/hooks/` (61 hooks) before creating new ones.
- **Follow the design system** — Stride orange (#E85D2D), Inter font, `theme.v2` tokens. See `_archive/Docs/Entity_Page_Design_Spec.md` for entity page design.
- **Update BUILD_STATUS.md at end of session.**

### Must-not-do

- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`.
- **React never calculates billing.** All billing logic stays server-side in Apps Script.
- **Never deploy from a worktree without merging to source first.** Silent reverts have broken the live app twice.
- **Never edit `dist/` by hand.** Only `npm run build` writes there.
- **Never edit the Master Price List sheet directly.** Use Price List page → inline edit → Sync to Sheet.
- **Never commit `.env`, `.credentials.json`, or any secrets.**
- **Never re-enable GitHub Actions `deploy.yml`/`ci.yml`** — renamed `*.disabled`, TLS transport issues unresolved.

---

## Doc Updates (end of session)

Every builder session must update these docs before reporting done:

**CODE_MAP.md** — Append entries for any new files created (pages, hooks, components, edge functions, migrations). If an existing feature area gained new files, add them to the existing section. Format: feature area → layer → file path.

**BUILD_STATUS.md** — Update "Recent Changes" with a summary of what was built/fixed this session. Include file locations so future builders can find the code. Update version numbers in the "Current Versions" table if any system version changed. Check off completed items in "Pending User Actions" if resolved.

**FEATURE_BACKLOG.md** — Check off any features that were completed this session. Add any new feature requests discussed with Justin that weren't built yet.

**Session_History.md** (`_archive/Docs/Archive/`) — Add a one-liner for this session: date + compressed summary of everything touched.

---

## Build Process

Every change must go through this sequence before being shipped:

1. **Write changes** — edit source files in `C:\dev\Stride-GS-app\stride-gs-app\src\`
2. **Type-check** — `node node_modules/typescript/lib/tsc.js --noEmit` (zero errors required)
3. **Full build** — `npm run build` (catches real bundler/vite errors the type-check misses)
4. **Code review** — spawn an Opus 4.7 subagent to review all diffs before committing
5. **Only after review passes:** branch → commit → `gh pr create --base source` → `gh pr merge --squash --delete-branch` → deploy

Do not skip steps. `tsc --noEmit` passing is not sufficient — always run `npm run build` to catch vite-level errors.

---

## Tech Stack

- **Build:** Vite + React 18 + TypeScript
- **Tables:** TanStack Table v8
- **Icons:** Lucide React
- **Router:** HashRouter (GitHub Pages SPA compatibility)
- **State:** React hooks + TanStack Query patterns (useApiData)
- **Supabase:** Read cache mirror of all entities + auth + DT integration + messaging + audit log

## Key Directories

```
src/
├── components/
│   ├── layout/          ← Sidebar, Header, AppLayout
│   ├── shared/          ← 60 reusable components (detail panels, modals, etc.)
│   └── ui/              ← Base UI primitives
├── hooks/               ← 61 hooks (data, UI, billing, messaging, etc.)
├── lib/
│   ├── api.ts           ← apiFetch<T>(), typed API functions
│   ├── supabase.ts      ← Supabase client
│   └── supabaseQueries.ts ← Read query helpers
├── pages/               ← 33 page files (14 main + entity detail pages + job pages)
└── types/               ← TypeScript type definitions
```

## API Connection

- **Endpoint:** StrideAPI.gs deployed as "Execute as Me, Anyone can access"
- **Auth:** Token via query parameter (`?token=xxx`)
- **Config:** Settings → Integrations → API Connection (URL + token stored in localStorage)
- **Pattern:** `apiFetch<T>(action, params?)` → returns typed data or throws
- **Hooks:** `useApiData(fetchFn)` → `{ data, loading, error, refetch }`

## Supabase

- **Migration files:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql` (57 migrations applied)
- **Apply migrations:** MCP tool `apply_migration(project_id='uqplppugeickmamycpuz', name, query)`. Write the SQL file first (git source of truth), then apply via MCP.
- **Client:** `src/lib/supabase.ts` — anon key in `.env` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **Edge Functions (6 deployed):** dt-backfill-orders, dt-push-order, dt-sync-statuses, dt-webhook-ingest, notify-new-order, stax-catalog-sync

## Role-based access

3 tiers: admin (full), staff (no billing/claims/payments/settings/delivery), client (own data only). Enforced in Sidebar nav arrays + `RoleGuard` route wrapper.

---

## Deploy Reference

**Golden rule:** Web App deployments are frozen snapshots. `push-*` pushes source; `deploy-*` makes it live.

All backend commands from `C:\dev\Stride-GS-app\AppScripts\stride-client-inventory\`. React commands from `C:\dev\Stride-GS-app\stride-gs-app\` (never from a worktree).

### First-time backend deploy setup (per builder / per fresh clone)

The `npm run push-*` / `deploy-*` scripts read Apps Script API credentials from `AppScripts/stride-client-inventory/admin/.credentials.json` + `client_secret.json`. These are gitignored and **not** in the repo. Before the first deploy from a fresh `C:\dev\Stride-GS-app` checkout, the builder must:

1. **Install deps:** `cd AppScripts/stride-client-inventory && npm install`
2. **Copy credentials** from the Dropbox source-of-truth into `admin/`:
   ```bash
   cp "C:/Users/expre/Dropbox/Apps/GS Inventory/credentials/.credentials.json" \
      "C:/dev/Stride-GS-app/AppScripts/stride-client-inventory/admin/.credentials.json"
   cp "C:/Users/expre/Dropbox/Apps/GS Inventory/credentials/client_secret.json" \
      "C:/dev/Stride-GS-app/AppScripts/stride-client-inventory/admin/client_secret.json"
   ```
   These files are local-only (in `.gitignore`). Never commit them.
3. **If the access token has expired:** `npm run refresh-auth` (or `npm run setup` for a clean re-auth).

After that, `push-api` / `deploy-api` / `push-stax` / `rollout` etc. all work directly. Builders should copy the credentials themselves and run the deploy commands rather than asking the user to do it manually.

| Change touched… | Command | Live in |
|---|---|---|
| React (`src/**`) | `npm run deploy -- "what changed"` (build → push dist → commit source) | 1–2 min |
| Supabase migration | MCP `apply_migration` | seconds |
| StrideAPI.gs | `npm run push-api && npm run deploy-api` | ~20s |
| Consolidated Billing | `npm run push-cb && npm run deploy-cb` | ~20s |
| Client scripts (×49) | `npm run rollout && npm run deploy-clients` | 3–4 min |
| Email/doc templates | Edit in app (Settings → Templates) | instant |
| Service rates/catalog | Price List page → inline edit | instant |

**React build safeguards:** `npm run build` routes through `scripts/build.js` (verify-entry → tsc → vite → sanity checks). `npm run build:raw` disables guards — emergency only.

**All-at-once after a big session:**
```bash
cd AppScripts/stride-client-inventory
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React (from stride-gs-app/):
npm run deploy -- "session summary"
```

---

## Architecture (compact)

```
Master Price List     →  pricing, class map, email/invoice templates (Supabase-authoritative now)
Consolidated Billing  →  storage charges, invoicing, client mgmt, QB export
Client Inventory (×N) →  per-client sheet: Inventory, Shipments, Tasks, Repairs, Will_Calls, Billing_Ledger
StrideAPI.gs          →  Web App doPost endpoint backing the React app
React app             →  GitHub Pages, reads StrideAPI + Supabase cache
Supabase              →  read cache mirror + DT delivery + messaging + audit log + auth
```

**Data flow:** GAS writes → Google Sheet (authoritative) → Supabase (best-effort write-through) → Realtime → React hooks refetch → UI updates in ~1–2s across all tabs.

**Key invariant:** Supabase is a read cache, not authority. GAS writes are the execution authority. Never block a GAS write on a Supabase failure.

---

## Key reference docs (load on demand)

| File | When to read |
|---|---|
| `CODE_MAP.md` | Feature → file location map. Read FIRST when debugging or building on existing features |
| `BUILD_STATUS.md` | What's built, what changed recently, current versions |
| `FEATURE_BACKLOG.md` | Features requested but not yet built |
| `_archive/Docs/Entity_Page_Design_Spec.md` | Entity page redesign visual spec (locked) |
| `_archive/Docs/DT_Integration_Build_Plan.md` | DispatchTrack integration plan + locked decisions |
| `_archive/Docs/Archive/Architectural_Decisions_Log.md` | Full list of 53 architectural decisions |
| `_archive/Docs/Archive/Session_History.md` | One-liner per builder session |
| `_archive/Docs/REPO_STRUCTURE.md` | Branch model + deploy flow |

---

## Deep Links — DO NOT BREAK

Email CTAs link to the React app and auto-open entity panels. **Always use query-param format with `&client=`:**
```
https://www.mystridehub.com/#/tasks?open=INSP-62391-1&client=<spreadsheetId>
```
Never route-style (`/#/tasks/INSP-62391-1`) — Gmail strips the `#` fragment. Without `&client=`, the detail panel never opens.

---

## Billing schema (compact)

**Service codes:** `STOR`, `RCVG`, `INSP`, `ASM`, `MNRTU`, `WC`, `REPAIR`, `PLLT`, `PICK`, `LABEL`, `DISP`, `RSTK`, `NO_ID`, `MULTI_INS`, `SIT`, `RUSH`.

**Status values:** Billing: `Unbilled` → `Invoiced` → `Billed` | `Void`. Inventory: `Active` | `Released` | `On Hold` | `Transferred`. Tasks: `Open` | `In Progress` | `Completed` | `Failed` | `Cancelled`. Repairs: `Pending Quote` → `Quote Sent` → `Approved`/`Declined` → `In Progress` → `Completed`/`Failed`. Will Calls: `Pending` | `Scheduled` | `Partial` | `Released` | `Cancelled`.

---

## Project IDs

- **Supabase:** `uqplppugeickmamycpuz`
- **Stride API (Apps Script):** `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M`
- **Consolidated Billing:** `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ`
- **GCP project:** `1011527166052` (higher Drive quotas)
