# GS Inventory — System Reference

> **Temporary Google Sheets system** for Stride Logistics (3PL warehouse, Kent WA). A full Stride WMS web app is being built separately — this runs operations (~60 clients) until that's ready.

**Owner:** Justin — manages ~60 client accounts, tests immediately.

## ⚠️ This is NOT the Stride WMS Web App

Do NOT use these skills — they're for the separate React/Supabase web app:
- `stride-wms-domain` — references SALA, RLS, SYSTEM_MASTER docs — not applicable here
- `stride-build-instructions` — same, not applicable

This project uses Google Apps Script, Google Sheets, Google Drive APIs — **plus Supabase as a read cache + failure tracking layer**. The Supabase integration is simpler than the WMS app's pattern; don't inherit WMS skill assumptions.

---

## Archive pointers (load on demand)

Historical and rarely-needed reference material has been moved to `Docs/Archive/`. Read these files only when relevant to the current task:

| File | When to read |
|---|---|
| `Docs/Archive/Session_History.md` | Need context on when a feature was built or a decision made — 68 session one-liners |
| `Docs/Archive/Deployment_Reference.md` | Full deployment guide, troubleshooting, auth prereqs, all npm commands |
| `Docs/Archive/Supabase_Integration_Plan.md` | Phase 1-4 Supabase integration details; open risks, manual steps |
| `Docs/Archive/Marketing_Manager_Plan.md` | Marketing Campaign Manager build plan (all 5 phases complete) |
| `Docs/Archive/QR_Scanner_Next_Phase.md` | Scanner Supabase direct lookup + auto-print labels build plan (not started) |
| `Docs/Archive/Architectural_Decisions_Log.md` | Full numbered list of 53 decisions — the "why" behind feature implementations |
| `Docs/Archive/Performance_Track_History.md` | Completed performance phases 1-3 with version numbers |

**Active build plans:**
| File | When to read |
|---|---|
| `Docs/DT_Integration_Build_Plan.md` | Full DT build plan — all phases, locked decisions, table schema, RLS summary, open questions |
| `Docs/Optimistic_Updates_And_Payments_Supabase_Plan.md` | Session-68 planned work: optimistic UI updates for every bulk action + Payments Supabase mirror (not started yet) |

Companion living doc: **`Docs/Stride_GS_App_Build_Status.md`** — current session changes, what's next, feature parity matrix.

---

## Repository Structure

**Canonical reference:** `Docs/REPO_STRUCTURE.md` — read that for the full branch model, deployment flow, parallel development stream rules, and health checks. This section is the compact summary.

After the session 59 cleanup and session 60 remote wiring, there are **exactly two git repositories** in this workspace, each with one clear job. If you see a third, something is wrong.

```
C:/Users/expre/Dropbox/Apps/GS Inventory/        ← PARENT REPO (source of truth)
├── .git/                                         ← remote: github.com/Stride-dotcom/Stride-GS-app
│                                                    tracks origin/source as default branch
├── .gitignore                                    ← excludes dist/, node_modules/, secrets,
│                                                    stride-client-inventory/ rollout tooling,
│                                                    *.tsbuildinfo, *.tmp.*, *.backup.*
├── CLAUDE.md                                     ← this file
├── Docs/                                         ← hot + cold docs, archive, build plans
├── AppScripts/
│   ├── stride-api/StrideAPI.gs                   ← TRACKED by parent (main backend)
│   ├── Consolidated Billing Sheet/               ← TRACKED
│   ├── stax-auto-pay/                            ← TRACKED
│   ├── QR Scanner/                               ← TRACKED
│   ├── stride-client-inventory/                  ← IGNORED by parent (see note below)
│   └── ...                                       ← other backend projects tracked
└── stride-gs-app/                                ← React app source, fully tracked by parent
    ├── src/                                      ← tracked (~140 files after cleanup)
    ├── public/                                   ← tracked (CNAME, favicon, icons)
    ├── scripts/                                  ← tracked (build orchestrator + entry guard)
    ├── supabase/migrations/                      ← tracked (DT Phase 1a+ migrations)
    ├── index.html                                ← tracked (VITE ENTRY — don't corrupt)
    ├── package.json                              ← tracked
    ├── tsconfig*.json, vite.config.ts            ← tracked
    └── dist/                                     ← NESTED REPO #2 (see below), parent IGNORES
        └── .git/                                 ← SEPARATE git repo, subtree deploy target
```

### Branch model on the single GitHub remote

Both local `.git` directories push to the same GitHub repo but target **different branches** with distinct responsibilities:

| Branch | Role | Who writes |
|---|---|---|
| `origin/source` | **Default branch.** Full parent workspace source of truth — backend, React, docs, tooling. All feature branches PR to this. | Parent repo (`GS Inventory/.git`) |
| `origin/main` | Built React bundle served by GitHub Pages. Force-pushed on every deploy. | Dist subtree (`stride-gs-app/dist/.git`) |
| `origin/feat/warehouse/*` | Warehouse / WMS feature branches | Parent repo |
| `origin/feat/delivery/*` | Delivery / DispatchTrack feature branches | Parent repo |
| `origin/feat/fix/*` | Hotfixes and small cleanups | Parent repo |

Legacy branches (`feat/dt-phase1a`, `feat/dt-integration-phase1a-migration`) are preserved for session-58/59 forensics but no longer receive new commits.

**Never merge `source` into `main` or vice versa.** `main` is compiled artifacts; `source` is human-readable source. They intentionally share no commit history.

### The dist subtree — separate `.git` with one job

**`stride-gs-app/dist/.git`** is a standalone git repository used as a GitHub Pages deploy target:

- **Remote:** `https://github.com/Stride-dotcom/Stride-GS-app.git`
- **Branch:** `main` (only)
- **Content:** built vite output (`index.html` + `assets/*.js` + `assets/*.css` + `CNAME`)
- **Lifecycle:** overwritten on every React deploy via `git push origin main --force`. No feature branches, no PRs, no source code.
- **Why separate:** GitHub Pages serves whatever is on `main`. Rather than juggle a `gh-pages` branch with subtree push gymnastics, the built output lives in its own standalone repo and gets force-pushed as a flat commit. Clean, simple, audit trail via "Deploy:" commit messages.

**Do not** `git init` inside `stride-gs-app/` or `AppScripts/stride-client-inventory/`. If you see a `.git/` directory appear in either location, it's a regression — delete it.

### Important: `AppScripts/stride-client-inventory/` is intentionally ignored by the parent repo

The rollout tooling directory is a **local master** for `npm run rollout`. The source of truth for each client's bound script lives in the client spreadsheet itself (pushed there via `clasp push`/`push-cb` equivalents). Editing a file under `stride-client-inventory/src/` and running rollout overwrites all active clients (47 as of session 64) with that content — the local copy is ephemeral tooling input, not authoritative source.

**Client registry (session 64 refactor):** the canonical map from each client spreadsheet → its bound script's scriptId lives in **CB Clients → SCRIPT ID column**. `npm run sync` pulls CB rows into `admin/clients.json`, `npm run rollout` pushes to each client's real bound script via the Apps Script API. Two self-healing paths for populating SCRIPT ID when blank:
1. **Onboarding / Finish Setup (React app):** calls `api_resolveBoundScriptViaRedirect_()` which fetches `https://script.google.com/d/<sheetId>/edit` with the caller's OAuth token and parses Google's 302 `Location` header for the bound scriptId. Authoritative — can't return template leakage, no Drive indexing lag.
2. **Rediscover Script IDs button (Settings → Clients):** calls the `backfillScriptIdsViaWebApp` StrideAPI endpoint, which POSTs `{token, action: "get_script_id"}` to each client's Web App URL. The client's bound RemoteAdmin.gs runs `ScriptApp.getScriptId()` in its own context and writes the result directly to CB. Requires `RemoteAdmin.gs v1.5.1+` already rolled out.

**Template-id pollution guard (v38.52.2+):** every write path to CB `SCRIPT ID` rejects the master template id `1Pk2Oc0u7RRgMs3sQs96brKDBFNA9vCyKOHZA9jMmk4gkD2yNdTGRlI5T`. Container-bound scripts often returned the template via Drive search; this guard prevents that from landing in CB and cascading into rollout targets.

**`deployments.update` → `deployments.create` fallback (`update-deployments.mjs` v2.2.0):** when a client's existing Web App URL was a deployment of the template (as was true for 42 of 47 clients before the session-64 cleanup), `deployments.update(targetScriptId, templateDeploymentId)` returns "not found". The script now catches that and creates a brand-new deployment on the correct script, then writes the new URL to both `clients.json` and `CB Clients.WEB APP URL`. Rate-limited to ~40/min (1500 ms pacing) with 30/60/90 s backoff to stay under Apps Script API's "60 management requests per user per minute" cap.

If you want that directory version-controlled in the future, that's a separate decision. For now it's excluded via `.gitignore` at the parent repo root, which is why `Emails.gs` edits don't show up in `git status` even though they reach production via rollout.

### Historical note — why this structure exists

Before session 59 there were **four** git repos stacked (parent, `stride-gs-app/`, `stride-gs-app/dist/`, `AppScripts/stride-client-inventory/`). The nested `stride-gs-app/.git` had a **sparse** HEAD tracking ~18 files while the working tree had ~200+ real source files that were orphaned from any git history. This caused the session-58 silent-build-failure regression (see `Docs/Archive/Session_History.md` session 59) where three weeks of React source changes never actually reached production.

The session-59 cleanup deleted the two junk nested repos (`stride-gs-app/.git`, `AppScripts/stride-client-inventory/.git`), unified everything under the parent repo, added the build safeguards (see below), and left `stride-gs-app/dist/.git` as the only nested repo because it serves a well-defined single purpose. The `feat/dt-phase1a` branch on `github.com/Stride-dotcom/Stride-GS-app` contains the full history of the old nested repo for forensics — commits `d384e48` (DT Phase 1b), `1cd8034` (build safeguards), `6f36457` (orphaned src/ restoration).

---

## Rules for Claude

### Must-do
- **Deploy before reporting done.** After every code change, run the deploy commands via Bash — don't describe them. See deploy table below. Only exception: user explicitly asks for instructions instead of execution.
- **Version header on every script edit.** Lines 1-3 of every `.gs`/`.js` file:
  ```
  /* ===================================================
     SCRIPT_NAME — vX.Y.Z — YYYY-MM-DD HH:MM AM/PM PST
     =================================================== */
  ```
  Patch bump for small fixes, minor bump for new features. Timestamps use PST (Justin is in WA). Never overwrite existing headers — use non-destructive updates.
- **Header-based column mapping.** Use `getHeaderMap_()` / `headerMapFromRow_()` everywhere. Never positional indexes.
- **Read files before editing.** Don't guess script contents. Grep for all references before removing a variable or moving logic.
- **Non-destructive header updates.** Rename legacy + append missing, never reorder/remove.
- **Work incrementally.** Small changes, deploy, test, fix. Don't write massive refactors in one pass.
- **Update docs at end of session.** See `Docs/Stride_GS_App_Build_Status.md` Recent Changes — CURRENT SESSION ONLY, don't accumulate. Add a one-line entry to `Docs/Archive/Session_History.md`.

### Must-not-do
- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`. `getLastRow()` returns false positives due to validations on empty rows.
- **Dropbox sync warning:** Main chat ONLY writes files. Subagents are READ-ONLY (use Explore agents for research, never for writes). Never use `isolation: "worktree"`. Dropbox sync conflicts with concurrent writes.
- **React never calculates billing.** All billing logic stays server-side in Apps Script. The React app only displays what the API returns.

### Task Board parity
When changing client-side functions or columns, check whether the Task Board script needs matching changes (shared handlers, editable sets, header arrays, exclusion lists). Shared handlers use `SH_` prefix with `SHARED_HANDLER_VERSION` constant.

---

## DEPLOYMENT RULES — MUST READ BEFORE ANY DEPLOY

### Never half-deploy

A deploy is only complete when ALL of the following are done:
- (a) `source` branch pushed to `origin/source`
- (b) `stride-gs-app/dist/` force-pushed to `origin/main` (GitHub Pages)
- (c) Any SQL migration files committed to the repo AND applied to the Supabase project via MCP tool
- (d) Any GAS changes deployed via the matching `deploy-*` command (not just pushed)

If any step is skipped, the deploy is incomplete. Do not report "done" until every applicable step is confirmed.

### Always run `tsc -b` before building — never `--skipLibCheck`

Run `node_modules/.bin/tsc -b` from `stride-gs-app/` before every production build. This uses project references and catches the full set of TypeScript errors. `--skipLibCheck` hides real errors; never use it as the final pre-deploy check.

### Uncommitted working-tree changes must be resolved before deploy

If `git status` shows unstaged or staged-but-uncommitted changes: STOP and report. Do not stash and proceed silently. The options are:
- Commit if the work is ready to ship
- Abort if the work is not ready (and document what was deferred)

Stash-and-forget caused broken builds in this project (merge conflicts surfaced after deploy started).

### Apply SQL migrations BEFORE deploying frontend code

If a new `.sql` migration file exists in `stride-gs-app/supabase/migrations/`, apply it to the Supabase project via MCP tool BEFORE the code deploy. Frontend code that references new columns will fail for live users until the schema exists.

### Verify the live bundle after deploy

After `git push origin main --force` from `stride-gs-app/dist/`, hard-refresh `mystridehub.com` (Ctrl+Shift+R) and check DevTools Network → the main JS bundle filename should match the new build hash. CDN cache takes 1-5 min.

### Post-deploy: update build status doc

After every deploy, add a summary to `Docs/Stride_GS_App_Build_Status.md` with: source commit hash, dist bundle hash, migration(s) applied (or "none"), and any warnings.

---

### WHY WE HAVE `source` + `main`

- **`source`** = source-of-truth TypeScript/React/GAS code. All feature branches merge here. This is what Claude edits and what humans review.
- **`main`** = compiled dist bundle only. GitHub Pages serves this branch. It is force-pushed from `stride-gs-app/dist/` on every React deploy and contains only `index.html`, `assets/*.js`, `assets/*.css`, and `CNAME`. It has no shared history with `source`.
- **Never merge source-code branches into `main`.** They have no common ancestor; the merge would produce a corrupt branch mixing TypeScript source with compiled bundles.
- **Never edit `dist/` manually.** Always build via `npm run build` in `stride-gs-app/` and let vite write the output. Manually edited dist files will be overwritten on the next deploy and may silently ship broken code.

---

## Deploy Reference (one table, one source of truth)

**Golden rule:** Web App deployments are **frozen snapshots**. `npm run rollout` / `push-api` push SOURCE but the live Web App serves the last DEPLOYMENT. You must run the matching `deploy-*` command after every push to Web App code. If in doubt, `npm run deploy-all`. See `Docs/Archive/Deployment_Reference.md` for full troubleshooting.

All commands run from: `AppScripts/stride-client-inventory/` (except React, which runs from `stride-gs-app/`).

| Change type | Push | Deploy (MANDATORY if Web App-facing) |
|---|---|---|
| `stride-client-inventory/src/*.gs` | `npm run rollout` | `npm run deploy-clients` |
| `StrideAPI.gs` | `npm run push-api` | `npm run deploy-api` |
| QR Scanner scripts | `npm run push-scanner` | `npm run deploy-cb` |
| CB scripts (if Web App touched) | `npm run push-cb` | `npm run deploy-cb` |
| Master Price List | `npm run push-master` | — |
| Task Board | `npm run push-taskboard` | — |
| Stax Auto Pay | `npm run push-stax` | — |
| Email templates | `npm run push-templates` | `npm run refresh-caches` |
| React app | (from `stride-gs-app/`) **`npm run deploy -- "what changed"`** — single command: build → push bundle to `origin/main` → commit + push source to `origin/source`. Both branches always stay in sync. | GitHub Pages auto (CDN 1-5 min; hard-refresh to verify) |
| Supabase migrations | Apply via MCP tool (see below) — no manual SQL editor needed | MCP `apply_migration` is the deploy |

**All-at-once after a big session:**
```bash
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React (from stride-gs-app/):
npm run deploy -- "session summary"
# Then any Supabase migrations via MCP tool
```

### Supabase Migrations (MCP tool)

Supabase schema changes go through the MCP tool — NOT the Supabase SQL Editor dashboard. This keeps migrations versioned and trackable.

- **MCP tool ID:** `mcp__94cd3688-d1f9-4417-a61a-6e38b1d2b097`
- **Supabase project ID:** `uqplppugeickmamycpuz`
- **Migration files live at:** `stride-gs-app/supabase/migrations/YYYYMMDDHHMMSS_name.sql`

| Operation | MCP function | When to use |
|---|---|---|
| Apply a new migration | `apply_migration(project_id, name, query)` | Every schema change (CREATE TABLE, ALTER TABLE, RLS, indexes) |
| List applied migrations | `list_migrations(project_id)` | Verify what's been applied |
| List current tables | `list_tables(project_id, schemas)` | Verify table state before/after |
| Run arbitrary SQL | `execute_sql(project_id, query)` | Data fixes, one-off queries, debugging |

**Naming convention for migration files:** `YYYYMMDDHHMMSS_snake_case_description.sql` (matches existing Supabase timestamp format).

**Always write the migration SQL to `stride-gs-app/supabase/migrations/` before applying** so the file is committed to git as the source of truth.

**`npm run deploy-all`** updates clients + StrideAPI Web App deployments in one shot. Idempotent, safe to run anytime.

### How to spot a stale deployment bug
If a remote admin or API call returns `ok: true` but the expected side-effect is missing (new column not added, new payload field ignored, new response field missing), **first check: did I run `deploy-*` after the last `push-*`?** 95% of the time that's the answer.

### React build safeguards (session 59)

`npm run build` in `stride-gs-app/` now routes through `scripts/build.js` — a wrapper that replaces the raw `tsc -b && vite build` chain with four phases and two sanity checks. It exists because session 58 shipped three sessions worth of React changes into production as **stale echo bundles** (see `Docs/Archive/Session_History.md` session 59 for the forensics). The safeguards make that exact failure mode impossible to recur silently.

**Phases:**

1. **verify-entry** (`scripts/verify-entry.js`) — reads `stride-gs-app/index.html` and rejects the build if it contains any `<script src="/assets/...">` tag (a built bundle reference written back into the source entry) OR if it's missing `<script type="module" src="/src/main.tsx">` (the React source entry). The session-58 regression was a built asset written into source `index.html` by some checkout operation — vite then treated the built asset as the entry, transformed 6 modules instead of ~1,875, and echoed the previous bundle.
2. **tsc -b** — TypeScript project check. Exits non-zero on type errors.
3. **vite build** — actual bundle, captured stdout so the orchestrator can parse it.
4. **post-build sanity checks:**
   - **Module-count floor (500)** — parses "N modules transformed" from vite's output. Real build ~1,875. Session-58 echo = 6. Anything under 500 fails the build.
   - **Bundle-size floor (500 KB)** — stats the biggest `.js` file in `dist/assets/`. Real bundle ~1.4 MB. Catches stub/empty outputs.

**Escape hatch:** `npm run build:raw` runs the original `tsc -b && vite build` without the safeguards. Only use it if you're absolutely sure the guards are a false positive — the normal path is `npm run build`. Any use of `build:raw` re-opens the session-58 vulnerability, so don't make it a habit.

**Testing the safeguards** (all three tested in session 59 and verified):
```bash
# Happy path — clean build should pass
npm run build                            # exit 0, 1,875 modules, 1.4 MB

# Failure path — break index.html with a built-asset reference
# (the verify-entry script will reject it with a clear banner)
npm run build                            # exit 1

# Recovery — restore index.html
npm run build                            # exit 0 again
```

---

## Architecture

4 interconnected Google Sheets, each with bound Apps Script, plus a standalone API project and a React frontend:

```
Master Price List (1)  →  pricing, class map, email/invoice templates
        ↓ reads pricing
Consolidated Billing (1)  →  storage charges, invoicing, client mgmt, QB export
        ↓ manages N clients
Client Inventory (N)  →  per-client: inventory, shipments, tasks, repairs, will calls, billing
Task Board (1)  →  cross-client task dashboard (decommissioning)

StrideAPI.gs (standalone)  →  Web App doPost endpoint backing the React app
React app (mystridehub.com)  →  GitHub Pages, reads StrideAPI + Supabase cache
Supabase  →  read cache mirror of 11 entity types (inventory, tasks, repairs, will_calls, shipments, billing, clients, claims, cb_users, locations, marketing_*) + item_id_ledger + move_history + delivery_availability + dt_orders + gs_sync_events
```

---

## File Structure (compact)

Top-level layout, all under the parent repo except `stride-gs-app/dist/` which is the separate subtree deploy repo (see Repository Structure above):

```
GS Inventory/
├── AppScripts/                             ← all Google Apps Script backends
│   ├── stride-api/StrideAPI.gs             — main API, backs React app (push-api + deploy-api)
│   ├── stride-client-inventory/src/        — rollout master (IGNORED by parent repo)
│   │   ├── Code.gs AutocompleteDB.gs Billing.gs Emails.gs Import.gs
│   │   ├── RemoteAdmin.gs Repairs.gs Shipments.gs Tasks.gs Transfer.gs
│   │   ├── Triggers.gs Utils.gs WillCalls.gs
│   │   └── admin/                          — rollout Node scripts: rollout.mjs, sync-clients.mjs,
│   │                                         verify-triggers.mjs, run-remote.mjs, setup-auth.mjs,
│   │                                         update-deployments.mjs, .credentials.json, clients.json
│   ├── Consolidated Billing Sheet/         — 11 .js files (push-cb + deploy-cb)
│   ├── Master Price list script.txt        — (push-master)
│   ├── task board script.txt               — (push-taskboard)
│   ├── QR Scanner/                         — 5 files (push-scanner + deploy-cb)
│   ├── stax-auto-pay/StaxAutoPay.gs        — (push-stax)
│   └── Email Campaign App/                 — stridecampaignv2.5.gs, separate project
│
├── Docs/                                   ← active docs + archive
│   ├── Stride_GS_App_Build_Status.md       — hot doc, replaced every session
│   ├── DT_Integration_Build_Plan.md        — DispatchTrack phases + locked decisions
│   └── Archive/                            — Session_History, Architectural_Decisions, etc.
│
├── Doc Templates/  EMAIL TEMPLATES/  INSTRUCTION GUIDES/  ← legacy static reference content
│
├── CLAUDE.md                               ← this file (root project reference)
├── .gitignore                              ← parent-repo ignore list
│
└── stride-gs-app/                          ← React app (Vite + React 19 + TypeScript + TanStack Table + HashRouter)
    ├── index.html                          ← VITE ENTRY — must reference /src/main.tsx (verify-entry.js enforces)
    ├── package.json                        ← build → scripts/build.js orchestrator
    ├── vite.config.ts                      ← vite config
    ├── tsconfig*.json                      ← TypeScript project refs
    ├── .env.example                        ← template (real .env is gitignored)
    ├── README.md
    ├── supabase/migrations/                ← Supabase schema migrations (YYYYMMDDHHMMSS_*.sql)
    ├── scripts/
    │   ├── build.js                        — orchestrator: verify-entry → tsc → vite → sanity checks
    │   └── verify-entry.js                 — pre-build guard against corrupted index.html
    ├── public/                             — CNAME, favicon.svg, icons.svg, stride-logo.png (vite copies to dist/)
    ├── src/
    │   ├── main.tsx                        — React entry point
    │   ├── App.tsx                         — HashRouter + routes
    │   ├── pages/                          — Dashboard, Inventory, Receiving, Tasks, Repairs, WillCalls,
    │   │                                     Shipments, Billing, Payments, Claims, Marketing, Orders, Settings,
    │   │                                     Login, Scanner, Labels, TaskJobPage, AccessDenied
    │   ├── components/
    │   │   ├── layout/                     — Sidebar, AppLayout, TopBar, FloatingActionBar
    │   │   ├── shared/                     — WriteButton, BatchGuard, ProcessingOverlay, detail panels,
    │   │   │                                 action modals, TemplateEditor, OnboardClientModal, etc.
    │   │   ├── settings/                   — Settings-page subcomponents
    │   │   ├── billing/                    — Billing-page subcomponents
    │   │   └── ui/                         — base UI primitives
    │   ├── hooks/                          — useClients, useInventory, useTasks, useRepairs, useWillCalls,
    │   │                                     useBilling, useOrders, useApiData, useTablePreferences, etc.
    │   ├── lib/
    │   │   ├── api.ts                      — typed fetch wrapper, all backend call bindings
    │   │   ├── supabaseQueries.ts          — Supabase read-cache queries
    │   │   ├── supabase.ts                 — supabase client init
    │   │   ├── types.ts                    — app-level TS types
    │   │   ├── apiCache.ts                 — in-memory + localStorage API cache
    │   │   ├── constants.ts                — shared formatters (fmtDate, fmtDateTime)
    │   │   └── entityEvents.ts             — cross-hook refetch bus
    │   ├── contexts/                       — React contexts (BatchData, etc.)
    │   ├── styles/                         — theme.ts
    │   └── data/                           — static seed data
    │
    └── dist/                               ← BUILT OUTPUT, served by GitHub Pages (own subtree repo)
        ├── .git/                           — standalone repo, remote: github.com/Stride-dotcom/Stride-GS-app
        ├── index.html                      — built by vite
        ├── assets/index-*.js               — bundled React + deps (~1.4 MB)
        ├── assets/index-*.css              — ~1 KB
        └── CNAME                           — copied from public/ by vite
```

---

## Google Sheets Tab Structure

**Master Price List:** `Price_List`, `Class_Map`, `Email_Templates`, `Invoice_Templates`, `Settings`

**Consolidated Billing:** `Clients`, `Locations`, `Users`, `Claims`, `Claim_Items`, `Claim_History`, `Claim_Files`, `Claims_Config`, `Unbilled_Report`, `Consolidated_Ledger`, `Billing_Log`, `Settings`, `QB_Service_Mapping`

**Client Sheet (×N):** `Inventory`, `Shipments`, `Tasks`, `Repairs`, `Will_Calls`, `WC_Items`, `Billing_Ledger`, `Move_History`, `Settings`, `Setup_Instructions`, `Price_Cache`, `Class_Cache`, `Location_Cache`, `Email_Template_Cache`, `Autocomplete_DB`

---

## Key Workflows

1. **Receiving** — Stride Warehouse → Complete Shipment → creates shipment folder + inventory items + RCVG billing + PDF + email.
2. **Task Creation** — Menu-driven (batch), lightweight rows only. Heavy work (Drive/PDF) deferred to "Start Task" checkbox.
3. **Start Task** — Creates task folder inside shipment folder, generates Work Order PDF, hyperlinks Task ID, sets Status to "In Progress".
4. **Storage Billing** — Stride Billing → Generate Storage Charges → per-item STOR charges (dedup by Task ID, respects FREE_STORAGE_DAYS + discounts).
5. **Invoicing** — Unbilled Report → Create & Send Invoices → grouped by client (optionally by sidemark) → Google Doc template PDF → email.
6. **Will Calls** — Create → assigns items + COD → Complete → updates inventory + WC billing. PDF generated at release time only.
7. **Release Items** — Batch set Release Date + Status=Released, records in Item Notes (staff/admin only).
8. **Tasks/Repairs Completion** — Result edit → billing on completion → email notification.
9. **Transfer Items** — Moves items + unbilled billing between client sheets. Writes Move History row on both sheets. Transferred ledger rows adopt destination rates (except REPAIR/RPR).
10. **Import Inventory** — Migration tool: old client tabs → new format (`IMP-MMDDYYHHMMSS` shipment #).
11. **Client Onboarding** — CB Clients tab checkbox or React modal → creates Drive folders + spreadsheet from template + syncs settings.

---

## Billing Schema

**Consolidated_Ledger is the single source of truth** for header names. Client Billing_Ledger syncs from it.

### Client Billing_Ledger Headers
```
Status | Invoice # | Client | Date | Svc Code | Svc Name | Category |
Item ID | Description | Class | Qty | Rate | Total | Task ID | Repair ID |
Shipment # | Item Notes | Ledger Row ID | Invoice Date | Invoice URL
```
Note: Sidemark is NOT a Billing_Ledger column. The API resolves it at read time from Inventory via `api_buildInvFieldsByItemMap_()` (StrideAPI.gs v38.6.0+).

### Service Codes
`STOR` (Storage), `RCVG` (Receiving), `INSP` (Inspection), `ASM` (Assembly), `MNRTU` (Minor Touch-Up), `WC` (Will Call), `REPAIR` (Repair), plus `PLLT`, `PICK`, `LABEL`, `DISP`, `RSTK`, `NO_ID`, `MULTI_INS`, `SIT`, `RUSH`.

### Status Values
- **Billing:** `Unbilled` → `Invoiced` → `Billed` | `Void`
- **Inventory:** `Active` | `Released` | `On Hold` | `Transferred`
- **Tasks:** `Open` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Repairs:** `Pending Quote` | `Quote Sent` | `Approved` | `Declined` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Will Calls:** `Pending` | `Scheduled` | `Partial` | `Released` | `Cancelled`

---

## Settings Keys

**Client Settings** (synced from CB Clients tab → client Settings tab):
`CLIENT_NAME, CLIENT_EMAIL, MASTER_SPREADSHEET_ID, CONSOLIDATED_BILLING_SPREADSHEET_ID, DRIVE_PARENT_FOLDER_ID, PHOTOS_FOLDER_ID, MASTER_ACCOUNTING_FOLDER_ID, FREE_STORAGE_DAYS, DISCOUNT_STORAGE_PCT, DISCOUNT_SERVICES_PCT, PAYMENT_TERMS, ENABLE_RECEIVING_BILLING, ENABLE_SHIPMENT_EMAIL, ENABLE_NOTIFICATIONS, AUTO_INSPECTION, SEPARATE_BY_SIDEMARK, QB_CUSTOMER_NAME, LOGO_URL, PARENT_CLIENT`

**CB Settings:**
`MASTER_SPREADSHEET_ID, CLIENT_PARENT_FOLDER_ID, CLIENT_INVENTORY_TEMPLATE_ID, DOC_TEMPLATES_FOLDER_ID, OWNER_EMAIL, NOTIFICATION_EMAILS, IIF_EXPORT_FOLDER_ID, NEXT_ITEM_ID` (auto-ID counter, starts at 80000)

**StrideAPI.gs Script Properties:**
`API_TOKEN, CB_SPREADSHEET_ID, MASTER_PRICE_LIST_SPREADSHEET_ID, CAMPAIGN_SHEET_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, STAX_API_KEY`

---

## Load-bearing Architectural Invariants

These are the top decisions that affect code generation on every task. For the full 53-item list with implementation notes, see `Docs/Archive/Architectural_Decisions_Log.md`.

1. **Consolidated_Ledger = authoritative billing schema.** Client ledgers sync from it. "Ledger Row ID" is canonical.
2. **Header-based column mapping only.** Never positional indexes.
3. **Non-destructive header updates.** Rename legacy + append missing, never reorder/remove.
4. **Settings sync is one-way:** CB Clients tab → client Settings tab.
5. **Drive folders are flat entity subfolders** under `DRIVE_PARENT_FOLDER_ID`: `Shipments/`, `Tasks/`, `Repairs/`, `Will Calls/`. `getOrCreateEntitySubfolder_()` self-heals on first use.
6. **Discount convention:** negative = discount, positive = surcharge, range **-100 to +100** (outside range is silently ignored as typo rail). Formula `rate * (1 + pct / 100)`. Transferred rows adopt destination rates (REPAIR/RPR excluded).
7. **Storage rate** = base per cuFt × class cubic volume × discount. Classes: XS=10, S=25, M=50, L=75, XL=110 cuFt.
8. **Task creation is menu-driven (batch).** Heavy work deferred to "Start Task" checkbox.
9. **Email/doc templates cached locally** (`Email_Template_Cache` tab). Check local first, fall back to Master.
10. **Storage charge dedup:** skip only Invoiced/Billed/Void; unbilled STOR rows deleted + recreated on each run.
11. **Remote admin uses Web App `doPost()`** (not `scripts.run` — blocked by 403 in this Workspace). Each client has a Web App deployment registered in `admin/clients.json`.
12. **Web App deployments are frozen snapshots.** Push ≠ deploy. Always run the matching `deploy-*` after `push-*`.
13. **onEdit parity for React:** Apps Script programmatic writes don't fire onEdit triggers. All onEdit side-effects must be replicated in StrideAPI.gs POST endpoints (field propagation to Tasks/Repairs, Task Notes aggregation, WC auto-promote).
14. **Role-based access:** 3-tier nav — admin = full, staff = no Billing/Claims/Payments/Settings, client = own data only. Enforced both in sidebar rendering and via `RoleGuard` route protection.
15. **Server cache invalidation:** CacheService 600s TTL on GET endpoints, invalidated on every relevant write. `noCache=1` bypasses cache for refresh buttons.
16. **LockService on concurrent-sensitive writes:** Start Task, completeTask, completeRepair, processWcRelease, getNextItemId, all Stax financial writes, claim create, campaign runNow.
17. **Parent/Child accounts:** One-level hierarchy via `PARENT_CLIENT` column on CB Clients. `getAccessibleClientScope_()` resolves scope with 60s cache. Parent users see own + children's data combined; email routing never auto-CCs parent.
18. **Sidemark on billing:** not a ledger column. Resolved at read time from Inventory via `api_buildInvFieldsByItemMap_()`. Supabase `billing` table has a `sidemark` column for write-through parity.
19. **PDF generation has retry-with-backoff** on Drive 403/429/5xx via `api_fetchWithRetry_` (1s/2s/4s/8s). StrideAPI.gs runs on a dedicated GCP project (number `1011527166052`) for higher Drive quotas.
20. **Supabase is a read cache, not authority.** GAS writes are the execution authority; Supabase mirrors via best-effort write-through. Never block a GAS write on a Supabase failure.
21. **Stax Autopay is a two-stage pipeline under a single lock** (Phase 4A, StaxAutoPay.gs v4.4.0+). Daily trigger → `_prepareEligiblePendingInvoicesForChargeRun` (auto-pushes eligible PENDING rows to CREATED via `_createStaxInvoicesForRows_`) → `_executeChargeRun` (charges the CREATED rows). A PENDING row due today with Auto Charge enabled is no longer stranded — it's pushed and charged in the same run. Manual `runCharges()` uses the identical path.
22. **Stax Autopay batch controls** (Phase 4B, StaxAutoPay.gs v4.5.0+). Charge stage runs sequentially with per-run cap (`MAX_AUTO_CHARGES_PER_RUN`, default 25, max 100), throttle delay (`AUTO_CHARGE_DELAY_MS`, default 1500ms), consecutive-failure circuit breaker (`AUTO_CHARGE_CIRCUIT_BREAKER_COUNT`, default 3), and wall-time watchdog (5m30s hard budget). Only 5xx/network/0/401/403 errors count as breaker fuel — 404/400/422 are treated as row-level bad data (logged, counter reset). Deferred rows stay CREATED with no sheet mutation and process on the next run. Config keys are seeded append-only on first read via `_getIntConfig_`.
23. **Stax Autopay Auto Charge override policy** is identical in the prepare and charge stages. Invoice TRUE always wins; invoice FALSE always skips (no log); blank invoice falls back to CB Clients with two distinct exception buckets — `CLIENT_AUTO_DISABLED` (client row exists with AUTO CHARGE=FALSE) and `UNKNOWN_CLIENT` (client not found in CB Clients). Both stages write Exceptions rows with stage-prefixed reason strings so operators can tell where the skip happened. Fixed the prior charge-stage divergence where `undefined` fell through and auto-charged.
24. **CB Clients column convention is canonical Title Case** (StrideAPI.gs v38.40.0+). All `setCol_` callers use the exact header case that ships in the sheet template ("Client Name", "Client Email", "Contact Name", "Phone", "Stax Customer ID", "Payment Terms", "QB_CUSTOMER_NAME" — the last is ALL-CAPS by QB convention). `api_ensureColumn_` does a case-insensitive match before auto-creating, so an existing bad-case header is reused instead of spawning a duplicate column. A prominent CONVENTION comment block above `setCol_` documents the rule. Read path is already case-tolerant via the `hMap` in `api_clientRowToPayload_`, so previously-saved rows with mis-cased headers surface their data immediately after deploy — no manual sheet cleanup needed.
25. **`item_id_ledger` is the authoritative cross-tenant registry** (StrideAPI.gs v38.52.0+, session 63). A legitimate exception to invariant #20 — this Supabase table is NOT a mirror of a sheet; it's the single source of truth for "has this Item ID ever been issued?" across all clients. `item_id` is globally unique, rows are never deleted, status evolves (`active`/`released`/`transferred`/`voided`) but the slot is permanently burned. StrideAPI.gs is the only writer via `api_ledger*_` helpers. `completeShipment` pre-check rejects cross-tenant collisions with `ITEM_ID_COLLISION`; same-tenant resubmits pass through (idempotent). `releaseItems` → status `released`; `transferItems` → `tenant_id` updated + status `active`. React `Receiving` page calls `checkItemIdsAvailable` on submit for a fast error before the GAS write. Degraded mode (Supabase unreachable): all helpers log + continue, writes never block. 22 pre-existing cross-tenant dupes from legacy `Import.gs` runs surfaced via `item_id_ledger_conflicts` view — all transfer leftovers, zero active-on-active, no cleanup needed. Client name in error messages resolved via `api_clientNameMap_()` (CacheService 5-min TTL, shared by preflight handler + router guard).
26. **`useClients` is a per-consumer hook, mitigated by in-memory cache + ref pattern** (session 63 revert). A `ClientsProvider` Context singleton was attempted in session 63 and reverted — it cleared the ~7-instance divergence but introduced a React #300 on client-filter click under the minified production build (cause never isolated; likely interaction between the conditional `useContext` fallback and consumer lifecycles across auth transitions). Current state: each consumer (page + 8 data hooks) calls `useClients()` independently, but all instances short-circuit on the in-memory `cacheGet` tier after the first fetch, so array references converge in practice. The **load-bearing mitigation for the Inventory React #300** is the `clientNameMap` ref-stabilization pattern in the 6 data hooks (`useInventory`/`useTasks`/`useRepairs`/`useWillCalls`/`useShipments`/`useBilling`) — always use the ref pattern when a hook builds a memo from `clients` and closes over it in a `useCallback` dep array. A cleaner singleton refactor is on the open-items list but not urgent.

---

## Current Versions

- **StrideAPI.gs:** v38.63.0 (Web App v283) — session 70 continued: Room→Reference column swap in all email/PDF item tables (`api_buildSingleItemTableHtml_` last positional arg changed `room`→`reference`, all 5 call sites + TRANSFER_RECEIVED `trCols` updated, Work Order PDFs emit `{{ITEM_REFERENCE}}` alongside legacy `{{ITEM_ROOM}}`, `api_findInventoryItem_` returns `reference`). NEW `updateRepairNotes` POST endpoint + `handleUpdateRepairNotes_` handler so office can save Repair Notes on an Approved repair BEFORE Start Repair (lightweight, no lock, no email, no PDF regen). Also carries v38.61–62: `handleGetPaymentTerms_`, `sbShipmentRow_` IK prefix strip, `handleSendRepairQuote_` photos URL fix, `handleResyncUsers_` admin tool, `lookupUser_` whitespace-normalized email match.
- **StaxAutoPay.gs:** v4.6.0 — session 69 Phase 2f: Supabase write-through at end of `_prepareEligiblePendingInvoicesForChargeRun` (invoices + run log) and `_executeChargeRun` (invoices + charge log + exceptions + run log). **Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY Script Properties on the Stax Auto Pay project** — see open items.
- **Triggers.gs (client):** v4.7.1 — session 70: VIEW INSPECTION PHOTOS button in REPAIR_QUOTE email now opens the Source Task folder (looks up task row in Tasks sheet and reads Task ID cell's hyperlink, set by `startTask_` to the task's Drive folder). Previously fell back to the Item folder because Source Task ID stores plain text, not a hyperlink.
- **Import.gs (client):** v4.3.0 — adds Reference column mapping (rolled out to all 49 active clients, session 70)
- **Emails.gs (client):** v4.6.0 — session 70 continued: Room column dropped from `buildItemsHtmlTable_` and `buildSingleItemTableHtml_`, Reference takes its place (rolled out to all 49 active clients)
- **WillCalls.gs (client):** v4.3.0 — Item ID / Vendor / Description / Reference columns on completed-WC email
- **RemoteAdmin.gs (client):** v1.5.1 — adds `get_script_id` action; writes own scriptId to CB Clients SCRIPT ID column
- **Code.gs (client):** v4.6.0 (rolled out to all 49 active clients)
- **StaxAutoPay.gs:** v4.5.0
- See `Docs/Stride_GS_App_Build_Status.md` for the full per-script version matrix and session history.

---

## Project IDs & URLs

**React App (GitHub Pages):**
- Live: https://www.mystridehub.com
- Repo: https://github.com/Stride-dotcom/Stride-GS-app
- QR Scanner repo: https://github.com/Stride-dotcom/Stride-GS-Scanner

**Google Sheets Spreadsheet IDs:**
- Master Price List: `1inonw5cd1YBaPA-dgkP-Rub9wOpqAgOlNE1sOJIdJPY`
- Campaign Spreadsheet: `1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg`
- Client sheets: see `admin/clients.json`

**Apps Script Project IDs:**
- **Stride API:** `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M` ([open](https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/edit))
- **Consolidated Billing:** `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ` ([open](https://script.google.com/u/0/home/projects/1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ/edit))
- **Master Price List:** `10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc` ([open](https://script.google.com/u/0/home/projects/10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc/edit))
- **Task Board:** `1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg` ([open](https://script.google.com/u/0/home/projects/1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg/edit))
- **Stax Auto Pay:** `1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4` ([open](https://script.google.com/u/0/home/projects/1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4/edit))

Client inventory scripts are NOT edited via direct URLs — use `npm run rollout`. Each client has its own bound copy. See `admin/clients.json` for client script IDs and Web App URLs.

**GCP:** StrideAPI.gs is linked to project `1011527166052` (Stride GS Inventory System) — eliminates Drive burst throttling. If the link ever gets broken, re-link via Apps Script editor → Project Settings → GCP Project → Change.

---

## Current Phase & Open Work

**Phase 6 Auth:** COMPLETE ✅ (email + password only, 3-tier role-based access, RoleGuard route protection)
**Phase 7A/7B/7C:** COMPLETE ✅ (all read endpoints, all 32+11 write endpoints, Claims end-to-end)
**Phase 8 (Additional Features):** mostly complete — see `Docs/Stride_GS_App_Build_Status.md` for the full matrix

### Active open items

- [x] **DispatchTrack Phase 1b** — React Orders tab live (admin-only, empty until Phase 1c ingest). Build `63207c2`. See `Docs/DT_Integration_Build_Plan.md`.
- [ ] **DispatchTrack Phase 1c** — Webhook ingest Edge Function. Needs DT account API credentials + webhook secret first.
- [ ] **Standalone Repair Detail Page (Phase 2)** — `#/repairs/:repairId` — same pattern as Task Detail, pending.
- [ ] **Standalone Will Call Detail Page (Phase 3)** — `#/will-calls/:wcNumber` — same pattern, requires WC items parity audit.
- [ ] **Generate Work Order button** — Manual PDF generation from TaskDetailPanel. Backend handler exists, needs React wiring + router case.
- [ ] **Seed Stax Supabase caches (one-time)** — Open Stride API in Apps Script editor → run `seedAllStaxToSupabase()` once. Populates `stax_invoices`, `stax_charges`, `stax_exceptions`, `stax_customers`, `stax_run_log` from the Stax spreadsheet. Until this runs, Payments page falls back to GAS on first load.
- [ ] **Set Supabase Script Properties on Stax Auto Pay project** — StaxAutoPay.gs v4.6.0 (session 69 Phase 2f) added Supabase write-through but the Stax Auto Pay Apps Script project is separate from Stride API, so it needs its own `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` Script Properties. Open `https://script.google.com/u/0/home/projects/1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4/edit` → ⚙️ Project Settings → Script Properties → add both (same values as Stride API project). Until set, the write-through is a silent no-op (by design) and Supabase will trail the autopay runs.
- [x] ~~Scanner Supabase Direct Lookup~~ — **DONE session 68/69**. Native React `/scanner` and `/labels` pages now use Supabase `item_id_ledger` for cross-tenant item resolution (~50ms) and Supabase `locations` mirror for the dropdown. New endpoint `batchUpdateItemLocations` writes per-tenant + central `move_history` audit. The old GAS iframe Scanner/Labels HTML web apps are no longer the React `/scanner` and `/labels` routes (they still exist for direct-URL access).
- [ ] **Auto-Print Labels from Receiving** — Toggle on Receiving page for inline label printing. See `Docs/Archive/QR_Scanner_Next_Phase.md` Feature B (still applies; Labels page is now native React so wiring is straightforward)
- [ ] **Parent Transfer Access** — Allow parent users to transfer items between their own children only (currently staff-only)
- [ ] **Global search expansion** — Add shipments, billing, claims entities + missing fields per audit
- [ ] **Autocomplete DB in React** — Sidemark/Vendor/Description per client
- [ ] **Invoice-level `invoiceDate` field** — Billing invoice summary currently falls back to earliest child date. Add a true `invoiceDate` to `InvoiceGroup` (sourced from Consolidated_Ledger "Invoice Date" column) so re-sorted children don't shift the displayed date.
- [ ] **Invoice number link in summary row** — Wire `invoiceUrl` through `InvoiceGroup` so the Invoice # cell renders as an anchor when a PDF URL exists (currently always renders as bold text).

### Known bugs (unresolved)

- `populateUnbilledReport_()` in CB `Code.gs.js` uses OLD header names ("Billing Status", "Service Date")
- `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- Transfer Items dialog needs processing animation + disable buttons after complete
- Multi-row selection only picks last row for Will Call creation and other functions
- Repair discount behavior — should disable discounts on repairs
- Autocomplete dropdowns in React: Room + Sidemark data mixed together
- Receiving page uses hardcoded table (no TanStack Table / no column reorder)
- **GitHub Pages CDN caching gotcha:** hard-refresh (Ctrl+Shift+R) after `git push` to verify deployed bundle hash

---

## Tools Reference

Quick index of every command, script, and MCP tool available in this workspace. Grouped by purpose. Run from the indicated directory.

### npm scripts — `AppScripts/stride-client-inventory/`

Backend rollout tooling. Push source to Google Apps Script projects and refresh their Web App deployments.

| Command | What it does |
|---|---|
| `npm run rollout` | Push all 13 `.gs` files to every client's bound script (47 active clients as of session 64). Runs `admin/rollout.mjs --execute`. Use after editing anything under `stride-client-inventory/src/`. **Always run `npm run sync` first** to pull the latest CB scriptIds into `clients.json` — otherwise rollout may target stale/wrong scripts. |
| `npm run rollout:dry` | Same as rollout but dry-run. Prints the target list without writing. |
| `npm run rollout:pilot` | Rollout to pilot group only (subset defined in `admin/clients.json`). |
| `npm run sync` | Pull client list (name, spreadsheetId, scriptId, webAppUrl) from CB Clients tab into `admin/clients.json`. Rejects the master template scriptId; falls through to Settings `_SCRIPT_ID` tab → Drive parent search → bulk-Drive scan (`getScriptIdViaBulkDrive`) as fallbacks. Run before every rollout when CB has been edited. |
| `npm run sync-web-urls` | Re-scan each client's Apps Script project and write the current Web App URL back to CB Clients tab. |
| `npm run verify` | Run `StrideRemoteVerifyTriggers_` on every client. Reports missing or broken onEdit triggers. |
| `npm run update-headers` | Remote-run `StrideRemoteUpdateHeaders_` on all clients to refresh missing sheet headers. |
| `npm run install-triggers` | Remote-run `StrideRemoteInstallTriggers_` on all clients (reinstall onEdit triggers). |
| `npm run refresh-caches` | Remote-run `StrideRemoteRefreshCaches_` on all clients (reload Price_Cache, Class_Cache, Email_Template_Cache from Master). |
| `npm run sync-caches` | Alias via `StrideRemoteSyncCaches_` — pushes Master template + price + class data to all clients at once. |
| `npm run sync-status` | Remote health check, returns sync state per client. |
| `npm run remote` | Generic `admin/run-remote.mjs` wrapper. Run any `StrideRemote*` function by name: `npm run remote -- --fn=FunctionName`. |
| `npm run push-api` | Push `AppScripts/stride-api/StrideAPI.gs` to its standalone Apps Script project. **Does NOT create a new Web App deployment** — must follow with `deploy-api`. |
| `npm run push-cb` | Push Consolidated Billing scripts (`AppScripts/Consolidated Billing Sheet/`) to the CB Apps Script project. |
| `npm run push-master` | Push Master Price List script. |
| `npm run push-taskboard` | Push Task Board script. |
| `npm run push-stax` | Push Stax Auto Pay script. |
| `npm run push-scanner` | Push QR Scanner scripts. |
| `npm run push-templates` | Push email templates from local source to Master Price List Email_Templates tab. |
| `npm run health-check` | Remote-run `StrideRemoteHealthCheck_` across all clients. |
| `npm run deploy-clients` | Create / update Web App deployment versions on every client. v2.2.0+: falls back to `deployments.create` when the existing deployment belongs to the wrong script (happens when `clients.json` was pointing at the template — fixed in session 64). Rate-limited to ~40/min with 30/60/90s backoff on quota errors. Writes new deployment URLs back to `clients.json` AND `CB Clients.WEB APP URL`. Required after any `npm run rollout` that affected `doPost` / remote actions. |
| `npm run deploy-api` | Create a new Web App deployment version on the standalone Stride API project. **Mandatory after `push-api`** — without it, the live Web App still serves the previous deployment. |
| `npm run deploy-cb` | Create new Web App deployment version on CB script. |
| `npm run deploy-all` | Clients + API + CB in one shot. Safe + idempotent. Use after a big session when in doubt. |

### npm scripts — `stride-gs-app/`

React app build + dev.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (`http://localhost:5173`). Hot module reload. |
| **`npm run deploy -- "msg"`** | **THE CORRECT DEPLOY COMMAND.** Runs `scripts/deploy.js`: build → push bundle to `origin/main` → commit+push source to `origin/source`. Both branches always updated together. Use this instead of manual steps. |
| `npm run build` | Build only (no git ops). Runs `scripts/build.js`: verify-entry → tsc -b → vite build (captured) → module-count floor → bundle-size floor. Aborts non-zero on any check. Use when you need just the build artifact (e.g. to inspect it before committing). |
| `npm run build:raw` | Escape hatch — raw `tsc -b && vite build` without safeguards. **Only use if you are certain the guards are a false positive.** Every use re-opens the session-58 vulnerability. |
| `npm run lint` | ESLint across all `src/`. |
| `npm run preview` | Serve `dist/` locally to verify the built bundle renders before deploying. |

### Deploy the React app to GitHub Pages

**One command does everything:**

```bash
cd stride-gs-app/
npm run deploy -- "what changed"
```

`scripts/deploy.js` runs three steps in sequence:
1. `npm run build` — verify-entry → tsc → vite → sanity checks (exits non-zero on any failure)
2. `dist/.git` — `git add -A && git commit "Deploy: ..." && git push origin main --force` → GitHub Pages
3. Parent repo — `git add -A && git commit "deploy(react): ..." && git push origin source` → source branch

**Both branches are always updated together.** This is the fix for the long-running bug where `origin/source` was perpetually behind because the old manual flow only pushed the bundle.

Do NOT use the old multi-step manual flow — it's what caused source to drift. The `npm run deploy` command is the only correct path.

**All-at-once after a big session:**
```bash
# Backend changes first:
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React:
cd stride-gs-app/
npm run deploy -- "session summary"
```

### MCP tools available in Claude Code

Reference for calling external services without leaving the chat. Tool name prefixes are shortened here — in actual invocations use the full `mcp__{uuid}__{tool}` name.

**Supabase (`mcp__94cd3688-d1f9-4417-a61a-6e38b1d2b097__*`)** — project `uqplppugeickmamycpuz`:
| Tool | Purpose |
|---|---|
| `apply_migration(project_id, name, query)` | Apply a new migration. Write the SQL to `stride-gs-app/supabase/migrations/YYYYMMDDHHMMSS_name.sql` first so it's tracked in git. |
| `execute_sql(project_id, query)` | Run ad-hoc SQL for debugging + data forensics (e.g., session 58 used this to confirm Supabase had stale `release_date` values). |
| `list_migrations(project_id)` | Verify what's been applied. |
| `list_tables(project_id, schemas)` | Schema inspection — useful before migration. Defaults `schemas=["public"]`. |
| `get_advisors(project_id, type)` | Security + performance advisors. Run after any DDL change to catch missing RLS. |
| `get_logs(project_id, service)` | Service logs (api, postgres, edge-function, auth, storage, realtime) — last 24 h. |
| `generate_typescript_types(project_id)` | Regenerate `src/lib/supabase.types.ts` after schema changes. |
| `deploy_edge_function(project_id, name, files)` | Deploy a Deno edge function. |
| `list_branches` / `create_branch` / `merge_branch` | Supabase dev branches (not currently used in this project). |

**Scheduled tasks (`mcp__scheduled-tasks__*`)** — cron-scheduled Claude runs:
| Tool | Purpose |
|---|---|
| `create_scheduled_task(taskId, prompt, description, cronExpression?)` | Schedule a recurring prompt to fire automatically. Cron is evaluated in local time. |
| `list_scheduled_tasks()` | See all scheduled tasks + their next run time. |
| `update_scheduled_task(taskId, ...)` | Update cron, prompt, enabled state, notification preference. |

### Claude Code built-in scheduling

In-session scheduling (doesn't persist across sessions unless `durable: true`):

| Tool | Purpose |
|---|---|
| `CronCreate(cron, prompt, recurring?, durable?)` | Enqueue a prompt to fire at a cron time. Recurring tasks auto-expire after 7 days. |
| `CronList()` | List session cron jobs. |
| `CronDelete(id)` | Cancel a scheduled prompt. |

### Build safeguards in stride-gs-app

| File | Purpose |
|---|---|
| `stride-gs-app/scripts/verify-entry.js` | Pre-build check — rejects corrupted `index.html` (must reference `/src/main.tsx`, never `/assets/*.js`). |
| `stride-gs-app/scripts/build.js` | Build orchestrator — runs verify-entry, tsc, vite, parses vite stdout for module count, validates bundle size. Aborts non-zero on any check. |

### TodoWrite / Task tracking

Use `TodoWrite` for any multi-step task (3+ steps) or when the user provides multiple tasks. See the tool description for full usage rules. Keep exactly one task `in_progress` at a time.

### Sub-agents

Use `Agent` with specialized `subagent_type`:

| Agent | When to use |
|---|---|
| `Explore` (quick / medium / very thorough) | Finding files, searching code, answering questions about the codebase. Read-only — safe to run in parallel. |
| `Plan` | Designing an implementation strategy before writing code. Returns step-by-step plans + identifies critical files. |
| `general-purpose` | Multi-step research tasks that don't fit Explore or Plan. |
| `claude-code-guide` | Questions about Claude Code itself (hooks, skills, MCP servers, settings). |

**Dropbox sync warning:** Sub-agents in this project must be **READ-ONLY**. Main chat does all file writes. Never pass `isolation: "worktree"` because Dropbox sync conflicts with concurrent writes.

---

## Document Maintenance Policy

### Hot docs (update every session)
- **`CLAUDE.md`** (this file): architecture, rules, invariants, current open items, known bugs
- **`Docs/Stride_GS_App_Build_Status.md`**: current session changes (REPLACE each session — do not accumulate), feature matrix, what's next

### Cold docs (update rarely, only when scope shifts)
- **`Docs/Archive/Session_History.md`**: add one-line entry per session
- **`Docs/Archive/Architectural_Decisions_Log.md`**: add new numbered decision when one is made; trim nothing
- Other archive files: update when the feature/phase they describe gets a major change

### Trimming rules
- Session entries in CLAUDE.md "Current Phase & Open Work" → only open items, never `[x] done`
- Completed phase plans → move the full plan to `Docs/Archive/`, leave a one-liner in CLAUDE.md
- Known bugs: remove once fixed and deployed
- Never expand session history into full changelogs — keep it one line per session, max ~200 chars
