# Stride GS App — Builder Instructions

> React frontend for Stride Logistics GS Inventory system. Google Sheets backend via Apps Script API + Supabase read cache + DispatchTrack delivery integration.

**Owner:** Justin — Stride Logistics, Kent WA
**Live:** https://www.mystridehub.com
**Repo:** https://github.com/Stride-dotcom/Stride-GS-app
**Clone:** `git clone https://github.com/Stride-dotcom/Stride-GS-app.git C:\dev\Stride-GS-app`
**Local path:** `C:\dev\Stride-GS-app` — this is the ONLY canonical location. Do NOT edit from Dropbox.
**Supabase:** `uqplppugeickmamycpuz` — `https://uqplppugeickmamycpuz.supabase.co`

---

## ⚠️ CRITICAL: Branching Rules

- **NEVER commit directly to `source`.** All work must happen on a feature branch.
- Every builder creates their own branch off `source` (e.g. `fix/bug-name`, `feat/feature-name`).
- When done: open a PR against `source`, get it reviewed, then squash-merge.
- Before starting work: always `git checkout source && git pull origin source` to get latest.
- If another builder's PR merges while you're working: rebase your branch (`git rebase source`) before opening your PR.
- Multiple builders CAN work simultaneously — branches keep everyone's work isolated.
- **COMMIT EARLY, COMMIT OFTEN.** As soon as a file edit is in a working state, commit it on your feature branch — *before* running typecheck, build, code review, or any other long-running step. Uncommitted changes are evaporated by `git pull` / branch-switch / `npm run deploy` (which calls `git add -A` on the parent repo), and parallel builders WILL trigger one of those while you're mid-flight. We've lost hours of work to this; treat an uncommitted edit as already-deleted. Use `git stash` for genuinely experimental WIP — never as a substitute for committing.

---

## ⚠️ CRITICAL: Worktrees for parallel builders

**Two builders sharing one working tree will overwrite each other's `HEAD`.** That's how 2026-05-02's misroute happened: builder A ran `git checkout -b fix/...` to start work; builder B then ran `git checkout feat/...` for theirs; A's next commit landed on B's branch because both shared one `HEAD`. Use git worktrees so each builder has an isolated `HEAD`, index, and working tree while sharing the same `.git` (objects, refs, remote).

### Starting a session

From the canonical clone, create a worktree on a new branch in one step:

```bash
cd /c/dev/Stride-GS-app
git fetch origin source
git worktree add -b fix/<scope>/<desc> /c/dev/stride-<topic> source
cd /c/dev/stride-<topic>
```

The `-b` form creates the new branch AND the worktree at `source`'s tip in one command. Don't omit `-b` and try to check out `source` directly — that fails with `'source' is already used by worktree at 'C:/dev/Stride-GS-app'` because the canonical clone has `source` checked out. Each branch can be in at most ONE worktree at a time; that's the lock that prevents HEAD-stomping in the first place.

`<topic>` should be short and unique among active worktrees. Examples: `stride-cancel-wc`, `stride-task-addons`, `stride-billing-fix`. Don't reuse names across active sessions.

### First time in a fresh worktree: install deps

`node_modules` is **not** shared between worktrees (only `.git` is — that's by design). Before `tsc --noEmit` / `npm run build` / `npm run deploy` will work, install:

```bash
cd /c/dev/stride-<topic>/stride-gs-app && npm install --no-audit --no-fund
cd /c/dev/stride-<topic>/AppScripts/stride-client-inventory && npm install --no-audit --no-fund   # only if you'll deploy GAS
```

npm's cache is shared across worktrees, so the second install in any worktree usually finishes in <10 seconds. `package-lock.json` is tracked, so the install is deterministic.

If you'll touch the React app, also copy the **complete** `.env` from the canonical clone (it's gitignored, so `git worktree add` doesn't carry it):

```bash
cp /c/dev/Stride-GS-app/stride-gs-app/.env /c/dev/stride-<topic>/stride-gs-app/.env
```

The `.env` must carry **all four** `VITE_` vars — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_API_TOKEN` — because `vite build` **inlines them into the bundle** at build time. A missing or partial `.env` silently bakes in `undefined`:
- missing Supabase → bundle crashes at module load (`Uncaught Error: supabaseUrl is required`, session 72).
- missing `VITE_API_URL` / `VITE_API_TOKEN` → `isApiConfigured()` is false, so **every page** shows "demo / API URL not configured" with no data (2026-06-03 site-wide outage — a deploy built from a partial `.env`).

A worktree is for **build/test only** — run actual deploys from the canonical clone (see Deploy Reference). The build preflight now aborts if any of the four is missing, so a partial `.env` fails loudly instead of shipping a broken bundle.

### Ending a session

After your PR merges:

```bash
cd /c/dev/Stride-GS-app
git worktree remove /c/dev/stride-<topic>
```

If you abandon work without merging, add `--force` to the remove. The `.git/worktrees/<topic>` admin folder is auto-cleaned.

### Listing + pruning

```bash
git worktree list      # show all active worktrees
git worktree prune     # garbage-collect stale worktree metadata
```

### What stays in the canonical clone

`/c/dev/Stride-GS-app` itself is the canonical clone (where `.git` lives). Use it for:
- One-off shell tasks (`git status`, `git log`, `git fetch`)
- Source-of-truth `source` checkouts
- Creating + removing worktrees

Avoid doing feature work directly in the canonical clone when other builders may be active — go to a worktree instead.

### npm scripts + worktrees

`npm run deploy` (in `stride-gs-app/`) calls `git add -A` on the parent repo. With worktrees, each has its own index, so the `add -A` only stages files in *your* worktree — adjacent builders' WIP isn't swept up. Still: commit early, commit often.

The GAS deploy scripts (`npm run push-api`, `npm run deploy-api` from `AppScripts/stride-client-inventory/`) work the same in any worktree — they read local file content and POST to Apps Script.

---

## Repo layout

```
C:\dev\Stride-GS-app\
├── stride-gs-app\     ← React app (Vite + TypeScript)
├── AppScripts\        ← Google Apps Script tooling + rollout scripts
├── _archive\          ← Docs, design specs, session history
├── CLAUDE.md          ← THIS FILE — canonical builder guide
└── stride-gs-app\CLAUDE.md  ← pointer to this file (do not edit)
```

## New machine setup

```bash
git clone https://github.com/Stride-dotcom/Stride-GS-app.git C:\dev\Stride-GS-app
cd C:\dev\Stride-GS-app\stride-gs-app && npm install
cd ..\AppScripts\stride-client-inventory && npm install
```

Then copy the 3 gitignored credential files from Dropbox into place:
```
Dropbox\Apps\GS Inventory\credentials\.credentials.json  →  AppScripts\stride-client-inventory\admin\
Dropbox\Apps\GS Inventory\credentials\client_secret.json →  AppScripts\stride-client-inventory\admin\
Dropbox\Apps\GS Inventory\credentials\.sync-config.json  →  AppScripts\stride-client-inventory\admin\
```

---

## Do NOT use these skills

`stride-wms-domain`, `stride-build-instructions` — those are for the separate Stride WMS web app, not this project.

---

## Rules

### Must-do

- **BRANCH FIRST.** See [⚠️ CRITICAL: Branching Rules](#-critical-branching-rules) above. Stream prefixes used here: `feat/warehouse/*`, `feat/delivery/*`, `feat/fix/*`.
- **Deploy AFTER merge.** `git checkout source && git pull origin source` then deploy commands.
- **Deploy before reporting done.** Execute via Bash, don't just describe.
- **TypeScript must stay clean** — run `npx tsc --noEmit` (or `node node_modules/typescript/lib/tsc.js --noEmit`) before finishing.
- **Version header on every `.gs`/`.js` edit.** Patch bump for fixes, minor for features. PST timestamps.
- **Header-based column mapping.** Use `getHeaderMap_()` / `headerMapFromRow_()`. Never positional indexes.
- **Use existing components** — check `src/components/shared/` (75 components) before creating new ones.
- **Use existing hooks** — check `src/hooks/` (75 hooks) before creating new ones.
- **Follow the design system** — Stride orange (#E85D2D), Inter font, `theme.v2` tokens. See `_archive/Docs/Entity_Page_Design_Spec.md` for entity page design.
- **Every new-table migration MUST include explicit GRANTs + RLS.** See [Supabase](#supabase) for the required 4-step template. Supabase begins enforcing this 2026-10-30: new tables without `GRANT … TO authenticated` are invisible to the Data API and the React app will silently 404 on them.
- **Update BUILD_STATUS.md at end of session.**

### Must-not-do

- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`.
- **React never calculates billing.** All billing logic stays server-side in Apps Script.
- **Never deploy from a worktree without merging to source first.** Silent reverts have broken the live app twice.
- **Deploy React ONLY from the canonical clone, never with a partial `.env`.** `npm run deploy` must run from `C:\dev\Stride-GS-app\stride-gs-app` (the only checkout guaranteed to hold the complete `.env`). The bundle bakes in all four `VITE_` vars at build time; a missing `VITE_API_URL` / `VITE_API_TOKEN` ships a config-less bundle and takes the **whole app down** — "API URL not configured" on every page (the 2026-06-03 outage, from a deploy built in a worktree/clone with an incomplete `.env`). The `vite.config.ts` preflight now aborts on any missing var; if a deploy FATALs with `… must be set in .env`, fix the `.env` (copy it from the canonical clone) — **never** reach for `npm run build:raw` to get past it.
- **Never edit `dist/` by hand.** Only `npm run build` writes there.
- **Never edit the Master Price List sheet directly.** Use Price List page → inline edit → Sync to Sheet.
- **Never commit `.env`, `.credentials.json`, or any secrets.**
- **Never re-enable GitHub Actions `deploy.yml`/`ci.yml`** — renamed `*.disabled`. (CI runners hit the same Windows schannel TLS instability the local deploy script now retries around — but reactivating CI for it is a separate project.)
- **Never regress the v38.182 atomic invoice-number counter.** `next_invoice_no()` Postgres SEQUENCE is the only thing standing between the system and the dup-number race repeating (the race that produced INV-000115 / 129 / 131 / 135 in the 2026-05-02→03 incident). Any "fallback to Master sheet counter" / "read-then-write" path is a regression. If you need a different numbering scheme (separate per-tenant sequences, etc.), build a NEW atomic source — don't reach back to the racy one.
- **Never commit a billing path that picks an `Invoiced` or `Void` row onto a new invoice.** The 2026-05-05 incident traced one stale-Void row (`INSP-TASK-INSP-62630-1`, voided 5/1 by a task reopen) being re-billed on a 5/3 invoice. The pre-commit Unbilled re-check (item #9 in `BUILD_STATUS.md` hardening backlog) is the prevention; until it ships, manually verify Unbilled status of every picked row before any new `handleCreateInvoice_` call site.

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

1. **Branch first** — `git checkout source && git pull origin source && git checkout -b feat/<stream>/<desc>`. Streams: `feat/warehouse/*`, `feat/delivery/*`, `feat/fix/*`. Never edit files on `source`.
2. **Write changes** — edit source files in `C:\dev\Stride-GS-app\stride-gs-app\src\`
3. **Commit immediately** — `git commit -am "..."`. Do this as soon as the edits compile in your head — *before* typecheck/build/review. A parallel builder's `git pull` or `npm run deploy` will erase any uncommitted file in your working tree without warning. See [⚠️ CRITICAL: Branching Rules](#-critical-branching-rules).
4. **Type-check** — `node node_modules/typescript/lib/tsc.js --noEmit` (zero errors required). If it fails, fix and amend or add a commit — never leave the fix uncommitted.
5. **Full build** — `npm run build` (catches real bundler/vite errors the type-check misses)
6. **Code review** — spawn the locked-in `code-reviewer` subagent (Opus 4.7, read-only) to review all diffs before merging. Defined in `.claude/agents/code-reviewer.md` with the Stride-landmine checklist baked in. Trigger via `Agent({subagent_type: 'code-reviewer', prompt: ...})` or the `/code-review` slash command. Never substitute `general-purpose` — the locked-in agent has the model + landmines pre-loaded and stays consistent across sessions/builders.
7. **PR + merge + deploy** — `git push -u origin <branch>` → `gh pr create --base source` → `gh pr merge --squash --delete-branch` → `git checkout source && git pull` → `npm run deploy -- "what changed"`

Do not skip steps. `tsc --noEmit` passing is not sufficient — always run `npm run build` to catch vite-level errors. Steps 1 and 3 are the ones that historically get skipped and cause the most pain.

---

## Tech Stack

- **Build:** Vite 8 + React 19 + TypeScript 5.9
- **Tables:** TanStack Table v8 + TanStack Virtual v3
- **Icons:** Lucide React
- **Router:** React Router v7 with HashRouter (GitHub Pages SPA compatibility)
- **State:** React hooks + TanStack Query patterns (useApiData)
- **Supabase:** Read cache mirror of all entities + auth + DT integration + messaging + audit log

## Key Directories

```
stride-gs-app/src/
├── components/
│   ├── layout/          ← Sidebar, Header, AppLayout
│   ├── shared/          ← 65 reusable components (detail panels, modals, etc.)
│   └── ui/              ← Base UI primitives
├── hooks/               ← 75 hooks (data, UI, billing, messaging, etc.)
├── lib/
│   ├── api.ts           ← apiFetch<T>(), typed API functions
│   ├── supabase.ts      ← Supabase client
│   └── supabaseQueries.ts ← Read query helpers
├── pages/               ← 40 page files (entity list pages + entity detail pages + job pages + public pages)
└── types/               ← TypeScript type definitions
```

## API Connection

- **Endpoint:** StrideAPI.gs deployed as "Execute as Me, Anyone can access"
- **Auth:** Token via query parameter (`?token=xxx`)
- **Config:** Settings → Integrations → API Connection (URL + token stored in localStorage)
- **Pattern:** `apiFetch<T>(action, params?)` → returns typed data or throws
- **Hooks:** `useApiData(fetchFn)` → `{ data, loading, error, refetch }`

## Supabase

- **Migration files:** `stride-gs-app/supabase/migrations/YYYYMMDDHHMMSS_name.sql` (~241 migrations applied — `ls supabase/migrations/*.sql | wc -l` for exact)
- **Apply migrations:** MCP tool `apply_migration(project_id='uqplppugeickmamycpuz', name, query)`. Write the SQL file first (git source of truth), then apply via MCP.
- **Client:** `stride-gs-app/src/lib/supabase.ts` — anon key in `.env` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **Edge Functions (~110 deployed in `supabase/functions/`):** DispatchTrack (dt-*), Stax (stax-*), notification (notify-*, send-*), shadow/replay helpers, and — as the GAS→Supabase migration shipped — a `-sb` handler for every write action plus 12 grouped-action clusters (`*-actions-sb`, `*-extras-sb`, `*-ops-sb`). `ls supabase/functions/` for the current list; CODE_MAP.md maps each to its feature.

### New-table migrations: REQUIRED 4-step template

Supabase enforces explicit role grants on the Data API path starting **2026-10-30**. A new table that has RLS policies but no `GRANT` is unreachable from the React app — PostgREST returns 404 / "permission denied for table" because the role can't even attempt the statement (the policy never runs). This is the modern PostgREST behavior; RLS `TO authenticated` in a policy is NOT a substitute for the table-level grant. Every migration that creates a public table MUST include all four of these, or it's a regression:

```sql
-- 1. Grant Data API roles enough to operate against the table.
--    Match the verbs your RLS policies allow — never wider.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;

-- 2. Service role bypasses RLS already, but Edge Functions / backfills
--    still need the table-level grant. Always include.
GRANT ALL ON public.<table> TO service_role;

-- 3. RLS must be ENABLED — otherwise the grants above let any
--    authenticated user read every tenant's rows. This is the
--    cross-tenant data leak path.
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

-- 4. At least one RLS policy. The grant decides "can the role
--    attempt this verb"; the policy decides "which rows it sees".
--    Without a policy, RLS-enabled = deny-all for non-service roles.
CREATE POLICY <table>_authenticated_select ON public.<table>
  FOR SELECT TO authenticated USING (<tenancy / ownership check>);
```

Anon access (e.g. `PublicServiceRequest.tsx`) is a separate, deliberate carve-out: add `GRANT SELECT ON public.<table> TO anon;` only when the table is intentionally part of an unauthenticated surface, with a policy that scopes what anon sees. Anon should NEVER get write grants unless the table is an explicit public-write surface (e.g. `public_service_requests`).

Look at `supabase/migrations/20260519140000_tax_jurisdictions_rls.sql` for an example of a complete policy block (it's missing the explicit GRANTs and will be fixed by `20260520120000_backfill_data_api_grants.sql` — but new tables should ship correct, not need backfilling).

## Role-based access

3 tiers: admin (full), staff (no billing/claims/payments/settings/delivery), client (own data only). Enforced in Sidebar nav arrays + `RoleGuard` route wrapper.

---

## Deploy Reference

**Golden rule:** Web App deployments are frozen snapshots. `push-*` pushes source; `deploy-*` makes it live.

React commands run from `C:\dev\Stride-GS-app\stride-gs-app\`.
AppScripts commands run from `C:\dev\Stride-GS-app\AppScripts\stride-client-inventory\`.
Never deploy from a worktree.

| Change touched… | Command | Live in |
|---|---|---|
| React (`src/**`) | `npm run deploy -- "what changed"` (build → push dist → commit source) | 1–2 min |
| Supabase migration | MCP `apply_migration` | seconds |
| StrideAPI.gs | `npm run push-api && npm run deploy-api` | ~20s |
| Consolidated Billing | `npm run push-cb && npm run deploy-cb` | ~20s |
| Client scripts (×49) | `npm run rollout && npm run deploy-clients` | 3–4 min |
| Email/doc templates | Edit in app (Settings → Templates) | instant |
| Service rates/catalog | Price List page → inline edit | instant |

**React build safeguards:** `npm run build` routes through `scripts/build.js` (verify-entry → tsc → vite → sanity checks). The `vite.config.ts` preflight **aborts the build** (`FATAL: … must be set in .env. Build aborted to prevent shipping a broken bundle.`) if any of the four required vars — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_API_TOKEN` — is missing, so an incomplete `.env` can't ship a config-less bundle (2026-06-03 outage prevention). `npm run build:raw` disables guards — emergency only; never use it to bypass a missing-env FATAL.

**Windows schannel TLS retry:** `scripts/deploy.js`'s `pushWithRetry` helper auto-retries any failing `git push` with `-c http.postBuffer=524288000 -c http.version=HTTP/1.1` — the recurring `SEC_E_MESSAGE_ALTERED (0x8009030f)` failure on the ~3MB bundle push has been reproducible enough that retry is built in. If you ever need to push manually (e.g. a recovery from a partial deploy), use the same flags.

**All-at-once after a big session:**
```bash
cd AppScripts/stride-client-inventory
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React (from stride-gs-app/):
cd ../../stride-gs-app
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

**Key invariant (production tenants):** Supabase is a read cache, not authority. GAS writes are the execution authority. Never block a GAS write on a Supabase failure.

> **⚠️ Migration in progress — the invariant is being reversed per-handler.** As of 2026-06-08 the **Justin Demo Account runs 100% on Supabase** (SB-primary writes with synchronous reverse-writethrough to the sheet), and **9 handlers have graduated fleet-wide** (the repair cluster + `updateShipment` + `generateStorageCharges` + `updateClient`). Routing is per-action via `feature_flags` resolved in `src/lib/apiRouter.ts` (`GAS_TO_SB_MAP`) — when a flag is `supabase` for the caller's tenant, `apiPost` lands on the `-sb` Edge Function instead of GAS. **Before changing any write path, read `stride-gs-app/MIGRATION_STATUS.md` (the Migration Scorecard) to know whether that handler is GAS, canary-SB, or fleet-SB.** For a handler already routed to SB, "GAS is authority" no longer holds — the SB write is primary and the sheet is the mirror.

---

## Key reference docs (load on demand)

| File | When to read |
|---|---|
| `stride-gs-app/MIGRATION_STATUS.md` | **First**, on any GAS→Supabase migration work. Authoritative living state for that project (decisions, per-function status, sub-phase progress). The v1.1 docx in Dropbox is a stakeholder snapshot, not authoritative. |
| `stride-gs-app/CODE_MAP.md` | Feature → file location map. Read FIRST when debugging or building on existing features |
| `stride-gs-app/BUILD_STATUS.md` | What's built, what changed recently, current versions |
| `stride-gs-app/FEATURE_BACKLOG.md` | Features requested but not yet built |
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

**Three-storage-layer model — writes to billing must touch all three:**

```
Client Billing_Ledger sheet (per-tenant)   ← SOURCE OF TRUTH for that client's rows
        │  writeThrough on every action
        ▼
public.billing (Supabase mirror)            ← React reads from here

Independent, parallel:
CB Consolidated_Ledger sheet                ← single sheet, all clients combined
                                              accounting aggregation, drives QBO push / IIF
```

Several open billing bugs (see `BUILD_STATUS.md` "Open billing-system hardening backlog") are because one of these three writes was forgotten. Every billing-touching change must explicitly handle all three or document why one is intentionally skipped.

---

## Billing incident context (2026-05-05 — read before touching billing code)

A customer-reported duplicate-invoice incident on 2026-05-05 cleaned up four pre-fix dup-number-race invoices and surfaced a hardening backlog. Reading `BUILD_STATUS.md` "Recent Changes (2026-05-05)" + "Open billing-system hardening backlog" is mandatory before any billing-path PR.

**Quick reference:**
- Root cause race fixed Mon 2026-05-04 in v38.182.0 (atomic Postgres `next_invoice_no()` SEQUENCE)
- 5 cousin bugs (#3-#7) + 3 detection gaps (#8-#10) **still open** — see backlog table in `BUILD_STATUS.md`
- One-shot cleanup function `runReleaseInvoicesForReissue` (StrideAPI.gs end of file, v38.192.0) was executed once 2026-05-05; **do not re-run** — kept as a reference template for the eventual generalized re-issue tool
- Detailed handoff for the planned hardening session lives in Justin's Dropbox at `Apps\GS Inventory\BILLING_HARDENING_HANDOFF.md` — paste verbatim into a fresh session to start the audit + fixes

---

## Project IDs

- **Supabase:** `uqplppugeickmamycpuz`
- **Stride API (Apps Script):** `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M`
- **Consolidated Billing:** `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ`
- **GCP project:** `1011527166052` (higher Drive quotas)
