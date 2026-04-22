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

Session 77 cleanup moved historical docs + templates under `_archive/` so the repo root stays focused on what's needed to ship. Everything below still lives in git — only the path changed.

**Historical reference (previously `_archive/Docs/Archive/`):**
| File | When to read |
|---|---|
| `_archive/Docs/Archive/Session_History.md` | Need context on when a feature was built or a decision made — 68+ session one-liners |
| `_archive/Docs/Archive/Deployment_Reference.md` | Full deployment guide, troubleshooting, auth prereqs, all npm commands |
| `_archive/Docs/Archive/Supabase_Integration_Plan.md` | Phase 1-4 Supabase integration details; open risks, manual steps |
| `_archive/Docs/Archive/Marketing_Manager_Plan.md` | Marketing Campaign Manager build plan (all 5 phases complete) |
| `_archive/Docs/Archive/QR_Scanner_Next_Phase.md` | Scanner Supabase direct lookup + auto-print labels build plan |
| `_archive/Docs/Archive/Architectural_Decisions_Log.md` | Full numbered list of 53 decisions — the "why" behind feature implementations |
| `_archive/Docs/Archive/Performance_Track_History.md` | Completed performance phases 1-3 with version numbers |

**Living docs + active build plans (relocated under `_archive/Docs/`):**
| File | When to read |
|---|---|
| `_archive/Docs/Stride_GS_App_Build_Status.md` | Current session changes, what's next, feature parity matrix. **Still updated every session** — path is under _archive only because of the session-77 root cleanup. |
| `_archive/Docs/DT_Integration_Build_Plan.md` | Full DT build plan — all phases, locked decisions, table schema, RLS summary, open questions |
| `_archive/Docs/PAYMENTS_REDESIGN_PLAN.md` | Payments page redesign plan — DRAFT, not yet executed |
| `_archive/Docs/Future_WMS_PDF_Architecture.md` | Future Stride WMS PDF architecture reference |
| `_archive/Docs/REPO_STRUCTURE.md` | Canonical branch model + deploy flow reference |

**Completed phase reports + research (superseded):**
| Path | What it was |
|---|---|
| `_archive/phase_reports/` | PHASE1/2A/2B/2C + SUPABASE_PHASE1/2/3 + SUPABASE_REALTIME_PLAN_REVIEW handoff reports |
| `_archive/build_plans/` | Completed Marketing / Optimistic Updates / PHASE_7D_A prompts |
| `_archive/research/` | Task Board research, Phase 7 + Stax parity audits |
| `_archive/legacy_sql/` | Pre-`supabase/migrations/` phase setup SQL |
| `_archive/reference/` | External vendor refs (DT API PDF, WMS zip, stride-build-instructions skill, old root package.json) |

**Template sources** (runtime copies live in Supabase):
| Path | Purpose |
|---|---|
| `_archive/EMAIL TEMPLATES/` | Source .txt files for the 19 email templates. Supabase `email_templates` is now authoritative; these remain as the import source for `seedEmailTemplatesToSupabase`. |
| `_archive/Doc Templates/` | Source files for invoice / work-order / settlement doc templates. Same pattern. |
| `_archive/INSTRUCTION GUIDES/` | WMS user-facing .docx guides (Billing, Inventory, Onboarding). |

---

## Repository Structure

**Canonical reference:** `_archive/Docs/REPO_STRUCTURE.md` — read that for the full branch model, deployment flow, parallel development stream rules, and health checks. This section is the compact summary.

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

Before session 59 there were **four** git repos stacked (parent, `stride-gs-app/`, `stride-gs-app/dist/`, `AppScripts/stride-client-inventory/`). The nested `stride-gs-app/.git` had a **sparse** HEAD tracking ~18 files while the working tree had ~200+ real source files that were orphaned from any git history. This caused the session-58 silent-build-failure regression (see `_archive/Docs/Archive/Session_History.md` session 59) where three weeks of React source changes never actually reached production.

The session-59 cleanup deleted the two junk nested repos (`stride-gs-app/.git`, `AppScripts/stride-client-inventory/.git`), unified everything under the parent repo, added the build safeguards (see below), and left `stride-gs-app/dist/.git` as the only nested repo because it serves a well-defined single purpose. The `feat/dt-phase1a` branch on `github.com/Stride-dotcom/Stride-GS-app` contains the full history of the old nested repo for forensics — commits `d384e48` (DT Phase 1b), `1cd8034` (build safeguards), `6f36457` (orphaned src/ restoration).

---

## Rules for Claude

### Must-do
- **BRANCH FIRST. Never commit directly to `source`.** Every task starts with `git checkout -b feat/<stream>/<desc>` from a fresh `source`. Streams: `feat/warehouse/*` (inventory/tasks/repairs/WC/billing/receiving/claims), `feat/delivery/*` (DT / orders / customer portal), `feat/fix/*` (hotfixes). Commit to the branch, push with `-u origin <branch>`, then give the user the PR compare URL (`https://github.com/Stride-dotcom/Stride-GS-app/compare/source...<branch>`). If `gh` CLI is installed, open + squash-merge the PR yourself. **This is load-bearing for multi-builder parallelism.** Committing to `source` directly causes Dropbox sync conflicts and silently overwrites another builder's work (happened in session 77 — Stage B GAS edits were wiped mid-session). Full workflow: `_archive/Docs/REPO_STRUCTURE.md`.
- **Deploy separately, AFTER merge.** Feature branches don't deploy. Once the PR is merged into `source`, pull source locally, then run `npm run deploy` from `stride-gs-app/`. The deploy script's parent-repo commit step (`git add -A` on source) only makes sense on an up-to-date `source` — running it mid-feature-branch-work couples build artifacts to unmerged code.
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
- **Update docs at end of session.** See `_archive/Docs/Stride_GS_App_Build_Status.md` Recent Changes — CURRENT SESSION ONLY, don't accumulate. Add a one-line entry to `_archive/Docs/Archive/Session_History.md`.

### Must-not-do
- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`. `getLastRow()` returns false positives due to validations on empty rows.
- **Dropbox sync warning:** Main chat ONLY writes files. Subagents are READ-ONLY (use Explore agents for research, never for writes). Never use `isolation: "worktree"`. Dropbox sync conflicts with concurrent writes.
- **React never calculates billing.** All billing logic stays server-side in Apps Script. The React app only displays what the API returns.

### Task Board parity
When changing client-side functions or columns, check whether the Task Board script needs matching changes (shared handlers, editable sets, header arrays, exclusion lists). Shared handlers use `SH_` prefix with `SHARED_HANDLER_VERSION` constant.

---

## Deployment Guide for Builders

> **TL;DR — React changes ship via `npm run deploy` from `stride-gs-app/`.** That one command does everything: build → force-push dist to `origin/main` (GitHub Pages) → commit + push source to `origin/source`. GitHub Actions CI/CD was wired up in session 72 but **disabled in session 77** (workflows renamed to `*.yml.disabled`) after transport-layer failures made it unreliable. Re-enable by renaming them back if/when those issues are resolved.

### Decision tree — "what does my change need?"

Start from the file you edited; follow the row; deploy the right channel. **Don't chain channels you don't need** — rolling out to 47 clients for a React-only change costs ~4 minutes and can ship half-tested GAS code.

| Change touched… | Channel | Command / action | Live in |
|---|---|---|---|
| `stride-gs-app/src/**` (React) | Manual | From `stride-gs-app/`: `npm run deploy -- "what changed"` | 1-2 min (CDN) |
| `stride-gs-app/supabase/migrations/*.sql` | MCP `apply_migration` | See § Supabase Migrations (MCP tool) | seconds |
| `AppScripts/stride-api/StrideAPI.gs` | clasp push + deployments.update | `npm run push-api && npm run deploy-api` | ~20s |
| `AppScripts/Consolidated Billing Sheet/**` | clasp + deployments.update | `npm run push-cb && npm run deploy-cb` | ~20s |
| `AppScripts/stax-auto-pay/**` | clasp | `npm run push-stax` | ~10s |
| `AppScripts/QR Scanner/**` | clasp + deployments | `npm run push-scanner && npm run deploy-cb` | ~20s |
| `AppScripts/stride-client-inventory/src/*.gs` (per-client) | rollout loop | `npm run rollout && npm run deploy-clients` | 3-4 min/47 clients |
| `AppScripts/Master Price list script.txt` | clasp | `npm run push-master` | ~10s |
| Email template content | Edit in app: Settings → Email Templates | (none — Supabase instant) | instant |
| Doc template content | Edit in app: Settings → Doc Templates | (none — Supabase instant) | instant |
| Service rate / catalog | Edit in app: Price List → inline edit | "Sync to Sheet" button if GAS billing still uses sheet | instant |
| `.github/workflows/*.yml` | n/a (workflows disabled) | See session-77 note at top — rename `*.yml.disabled` back to re-enable | — |

The `AppScripts/stride-client-inventory/` directory is BOTH the rollout master (where `npm run rollout` reads from) AND the home of every `deploy-*` script. All commands in the tables below run from that directory.

### React App Changes (MANUAL — `npm run deploy`)
- From `stride-gs-app/`: `npm run deploy -- "description of what changed"`
- The script does all three steps in order: (1) `npm run build` (verify-entry → tsc → vite → sanity checks), (2) commit + force-push `dist/` to `origin/main` as a "Deploy:" commit, (3) commit + push source to `origin/source` as a "deploy(react):" commit.
- Live at mystridehub.com in 1-2 minutes after the GitHub Pages CDN refreshes
- Hard-refresh (Ctrl+Shift+R) to verify the new bundle hash matches
- If you see transient `schannel SEC_E_MESSAGE_ALTERED` or similar TLS errors on the push: retry. Intermediate network appliances occasionally MITM-inspect GitHub pushes and break the TLS session. Set `git config http.version HTTP/1.1` if it persists.
- Workflows in `.github/workflows/` that could auto-deploy this (`deploy.yml`, `ci.yml`) were renamed to `*.disabled` in session 77 because the Actions runner hit similar intermittent failures. `migrate.yml` (manual-trigger only) is still active for production migrations.

### Google Apps Script Changes (MANUAL — requires Google OAuth)
- Edit files in `AppScripts/stride-api/`
- Deploy: `cd AppScripts/stride-client-inventory && npm run push-api && npm run deploy-api`
- Requires `.credentials.json` (Google OAuth) — only available on the project owner's machine
- If you don't have credentials: commit your GAS changes to `source`, note in the PR that GAS deploy is needed, and the project owner will deploy
- After GAS deploy: bump the version in StrideAPI.gs header comment

### Client Script Rollout (MANUAL — only for sheet schema changes)
- `npm run rollout` — pushes GAS code to all client sheets
- `npm run deploy-clients` — deploys Web Apps for all clients
- `npm run refresh-caches` — refreshes client-side caches
- Only needed when: adding new sheet columns, changing GAS function signatures, or updating client-side automation
- NOT needed for: rate changes (Supabase), template changes (Supabase), React UI changes (auto-deploy)

### Supabase Schema Changes (migrations)
- Create migration file in `stride-gs-app/supabase/migrations/`
- Apply via: Supabase MCP tool (`apply_migration` — preferred) OR the still-active `migrate.yml` GitHub Actions workflow (`workflow_dispatch`, manual trigger) OR the Supabase Dashboard SQL editor
- Always test migrations on a branch first if destructive

### Templates (email, document, invoice)
- Edit in app: Settings → Email Templates → Edit
- Changes are INSTANT — no deploy needed
- Stored in Supabase `email_templates` table
- GAS reads from Supabase on next email/PDF generation

### Price List / Service Catalog
- Edit in app: Price List page → inline edit
- Changes are INSTANT in Supabase
- Click "Sync to Sheet" button to update the Master Price List Google Sheet (needed for GAS billing lookups until Phase 5 cutover is complete)

### What NOT to do
- NEVER edit `dist/` by hand — only `npm run deploy` writes there (force-push territory; a manual edit will be clobbered on the next build anyway)
- NEVER re-enable `deploy.yml` / `ci.yml` without testing that the TLS transport issues from session 77 are resolved — the workflows will just silently fail again and leave `origin/main` behind
- NEVER edit the Master Price List sheet directly — edit in the app, then Sync to Sheet
- NEVER skip `tsc -b` before committing — `npm run deploy` will catch it but it wastes time
- NEVER commit `.env`, `.credentials.json`, or any secrets

### Troubleshooting — "I pushed but it didn't ship"

First line of diagnosis: **which channel carries this change?** (see decision tree above). Every failure mode below is scoped to one channel.

- **React change pushed, mystridehub.com still shows old bundle** →
  1. Did you run `npm run deploy`? Just `git push origin source` no longer ships anything — Actions is disabled (session 77). You must run `npm run deploy -- "..."` from `stride-gs-app/` to build + push dist.
  2. Hard-refresh (Ctrl+Shift+R). GitHub Pages CDN caches ~1-5 min.
  3. Still stale after 5 min? Compare DevTools Network → main `index-*.js` filename against the hash in your local `stride-gs-app/dist/assets/`. If they match, CDN is just slow. If local is ahead of remote, the dist push failed silently — `cd stride-gs-app/dist && git status` will show if `origin/main` is behind.
  4. If the push itself fails with `schannel SEC_E_MESSAGE_ALTERED` or similar TLS errors, retry. If it persists, `git config http.version HTTP/1.1` in `dist/.git/config` usually fixes it.
- **GAS change pushed but Web App still runs the old code** → you ran `push-api` but skipped `deploy-api`. `push-api` updates source; `deploy-api` creates a new frozen Web App version. Always chain: `npm run push-api && npm run deploy-api`.
- **Client bound-script change pushed via rollout but one client still shows old behavior** → `rollout` pushes source to all 47 clients; `deploy-clients` creates a new Web App deployment for each. If one client is stale, their Web App deployment failed (check rollout log) or their Drive quota throttled the deploy — re-run `deploy-clients` (idempotent).
- **Supabase schema change applied but the app 400s on write** → the MCP `apply_migration` ran but the TypeScript types in `src/lib/supabase.types.ts` are stale. Re-run `generate_typescript_types` OR add the new column to the insert/update payload manually in the hook.
- **Template edit doesn't show in next email** → Email/doc templates are cached in GAS for 10 min (`CacheService`). Either wait, or hit `Settings → Maintenance → Refresh Caches` to evict immediately. Per-client `push-templates` is only needed for the initial seed.
- **Price List change doesn't affect billing** → Until Phase 5 cutover is complete, GAS billing still reads the Master Price List sheet, not Supabase. Click "Sync to Sheet" on the Price List page to push Supabase rates back to the sheet.
- **Migration runner fails with "workflow_dispatch not found"** → `migrate.yml` needs to be present on the branch you're pointing at. Push the workflow file to `source` first, then trigger.

### Known half-deploy traps

- **Missing `&client=` on deep links** → see § Deep Links. Every email CTA must include it; test with a staff user AND a client user.
- **Race between GAS write and Supabase write-through** → GAS writes the sheet, then resyncs the entity to Supabase (best-effort). If the Supabase call silently fails (network, missing column, RLS), the React app reads stale data until the next write wakes it up. Check `gs_sync_events` table for failed resyncs after every deploy that touched a handler.
- **New Supabase column used by React BEFORE migration applied** → `{col} does not exist` in prod only. Apply the migration first, **then** deploy the React bundle. `migrate.yml` + Actions `deploy.yml` don't gate each other.
- **Worktree `.env` missing** → if deploying from `.claude/worktrees/**`, copy `stride-gs-app/.env` from the parent first. Vite silently inlines `undefined` and the runtime crashes at module load with `supabaseUrl is required`. The build is structurally valid so the safeguards don't catch it.

---

## PARALLEL BUILD WORKFLOW — MANDATORY FOR ALL SESSIONS
=========================================================

⚠️ NEVER deploy directly from a repair/feature session. ALL sessions must follow this workflow:

### How parallel work works:
1. Each session works in its own git worktree (automatic with Claude Code)
2. Make your changes on the worktree branch
3. Push the branch to origin
4. Create a PR using `gh pr create`
5. DO NOT build, DO NOT deploy, DO NOT touch the dist repo
6. Report what was changed and the PR URL

### Who deploys:
- Only ONE coordinating session merges PRs and deploys
- Deploy happens from the MAIN workspace only (`C:\Users\expre\Dropbox\Apps\GS Inventory`)
- Multiple PRs can be merged before a single deploy
- Deploy follows the existing DEPLOYMENT RULES (build from main workspace, verify app loads)

### Why:
- Multiple sessions deploying independently overwrite each other's work
- The dist repo has one `main` branch — last push wins, previous deploys are lost
- Dropbox sync conflicts happen when multiple sessions touch the main workspace

### Rules:
1. NEVER run `npm run build` or `git push origin main` from a worktree session
2. NEVER copy files to the main workspace dist folder from a worktree session
3. Always create a PR instead of deploying
4. If your changes include GAS (StrideAPI.gs, CB scripts), note it in the PR description — GAS deploys are also coordinated, not independent
5. Include "DO NOT DEPLOY — PR only" in your session's final report if you followed this workflow

---

## DEPLOYMENT RULES — MUST READ BEFORE ANY DEPLOY

```
⚠️ WORKTREE DEPLOY TRAP: The stride-gs-app/dist/ folder in a worktree does NOT
have its own .git repo. Pushing from there pushes the PARENT worktree's source
files to GitHub Pages, breaking the live app. ALWAYS deploy from the main workspace.
```

### NEVER deploy the React bundle from a worktree

This has broken the live app twice. The `stride-gs-app/dist/` directory inside a git
worktree has **no `.git` of its own** — git commands run there fall back to the parent
worktree repo and push source files (`.tsx`, `.gs`) to `origin/main` instead of built
assets. GitHub Pages then serves raw TypeScript instead of the bundle.

**The only correct dist repo is:**
```
C:\Users\expre\Dropbox\Apps\GS Inventory\stride-gs-app\dist\.git
```
That repo is on branch `main` and is the sole GitHub Pages deploy target.

**If you are working in a worktree, the deploy process is:**

```bash
# Step 1 — Build in the worktree (gets .env from parent first)
cp "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/.env" \
   "<worktree>/stride-gs-app/.env"
cd "<worktree>/stride-gs-app"
npm run build

# Step 2 — Copy built files to the MAIN workspace dist repo
cp -r "<worktree>/stride-gs-app/dist/." \
   "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/dist/"

# Step 3 — Deploy FROM THE MAIN WORKSPACE dist repo (has .git on main branch)
cd "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/dist"
# Remove any old bundle chunks that weren't in this build:
git ls-files assets/ | grep -v -F "$(ls assets/)" | xargs git rm -f 2>/dev/null || true
git add -A
git commit -m "Deploy: <description>"
git push origin main --force
```

**Quick check — before any dist push, verify you are in the right repo:**
```bash
git remote -v   # must show: origin → github.com/Stride-dotcom/Stride-GS-app
git branch      # must show: * main
git log --oneline -1  # must show a "Deploy:" commit, not a source commit
```
If `git branch` shows `* claude/...` or `* source`, STOP — you are in the wrong repo.

### POST-DEPLOY VERIFICATION (mandatory after every React deploy)

After the `git push origin main --force`:

1. Wait 1–2 minutes for the GitHub Pages CDN to refresh.
2. Open https://www.mystridehub.com and hard-refresh (Ctrl+Shift+R).
3. Confirm the app loads (no blank page, no `supabaseUrl is required` error).
4. DevTools → Network → filter `.js` → confirm the bundle filename matches the hash just deployed (e.g. `index-BjQQczFO.js`).
5. If the app doesn't load, **immediately revert** by deploying the previous bundle:
   ```bash
   cd "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/dist"
   git revert HEAD --no-edit
   git push origin main --force
   ```

### Apps Script deploys are independent of React deploys

GAS changes never go through `stride-gs-app/dist/`. Always run them from `AppScripts/stride-client-inventory/`:
- `npm run push-api && npm run deploy-api` — StrideAPI.gs (sequential, mandatory)
- `npm run push-cb && npm run deploy-cb` — CB scripts (sequential, mandatory)
- `npm run rollout && npm run deploy-clients` — all client scripts

Push ≠ deploy for Web App-facing GAS code. If you only `push-*` without `deploy-*`, the live Web App still serves the previous frozen snapshot.

---

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

### If deploying from a git worktree — READ THE WORKTREE TRAP SECTION FIRST

See **"NEVER deploy the React bundle from a worktree"** above for the full step-by-step. The short version: build in the worktree, copy built files to the main workspace dist, push from the main workspace dist repo only.

**Also: copy `.env` before building.** `.env` is `.gitignored`; a fresh worktree has no Supabase credentials. Vite silently inlines `VITE_SUPABASE_URL = undefined` and the live app crashes with `Uncaught Error: supabaseUrl is required.`

```bash
cp "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/.env" \
   "<worktree>/stride-gs-app/.env"
grep -c VITE_SUPABASE_URL stride-gs-app/.env   # must print 1
```

This bit us in session 72 — caught only by a production runtime error, not the build.

### Ask before preview-verifying a UI change

For any change that affects an authenticated React page (a feature, a layout fix, a new component, anything the user would notice in the browser), **ask the user whether to preview-verify before deploying**. Short prompt, two choices:

> "Want me to preview-verify this before deploy? (yes → I'll launch the dev server with the auth bypass, navigate to the affected page, click / eval to confirm the behavior, then continue to build. no → I'll just typecheck and build.)"

If they say yes, the preview-verify flow is:

1. Set `VITE_DEV_BYPASS_AUTH=true` in `stride-gs-app/.env` (session 72+ dev-only bypass, gated by `import.meta.env.DEV` and tree-shaken out of production bundles).
2. `preview_start` the `stride-gs-app` config.
3. `preview_eval` to navigate to the affected page (`window.location.hash = '#/labels'` etc.) and wait for mount.
4. `preview_click` and/or `preview_eval` to exercise the feature — click the new button, focus the new input, check that the DOM reflects the change.
5. `preview_console_logs` with `level: 'error'` to confirm no runtime errors.
6. `preview_stop`, then **flip the bypass back to `false`** before the production build so the env var is deterministic.
7. Report what was verified (and what wasn't — the bypass can't defeat Supabase RLS, so data-dependent behavior is partial).

If they say no, skip straight to `npm run build`.

**Skip the ask for:** pure backend changes (StrideAPI.gs, GAS-side only), docs-only changes, typo fixes, Supabase migrations, or anything that isn't visible in the React UI. For those, `npm run build` directly.

**Why this exists:** before session 72, preview-verification could only confirm the app mounted past module-load; the login wall blocked every authenticated page. The dev bypass now lets the preview workflow actually click around authenticated surfaces — but it's heavier than just building, so it's opt-in per change.

### Apply SQL migrations BEFORE deploying frontend code

If a new `.sql` migration file exists in `stride-gs-app/supabase/migrations/`, apply it to the Supabase project via MCP tool BEFORE the code deploy. Frontend code that references new columns will fail for live users until the schema exists.

### Verify the live bundle after deploy

After `git push origin main --force`, follow the **POST-DEPLOY VERIFICATION** steps in the "DEPLOYMENT RULES" section above. Hard-refresh `mystridehub.com` (Ctrl+Shift+R), confirm no blank page/errors, and check DevTools Network → the main JS bundle filename matches the new build hash. CDN cache takes 1–5 min. If the app is broken, revert immediately.

### Post-deploy: update build status doc

After every deploy, add a summary to `_archive/Docs/Stride_GS_App_Build_Status.md` with: source commit hash, dist bundle hash, migration(s) applied (or "none"), and any warnings.

---

### WHY WE HAVE `source` + `main`

- **`source`** = source-of-truth TypeScript/React/GAS code. All feature branches merge here. This is what Claude edits and what humans review.
- **`main`** = compiled dist bundle only. GitHub Pages serves this branch. It is force-pushed from `stride-gs-app/dist/` on every React deploy and contains only `index.html`, `assets/*.js`, `assets/*.css`, and `CNAME`. It has no shared history with `source`.
- **Never merge source-code branches into `main`.** They have no common ancestor; the merge would produce a corrupt branch mixing TypeScript source with compiled bundles.
- **Never edit `dist/` manually.** Always build via `npm run build` in `stride-gs-app/` and let vite write the output. Manually edited dist files will be overwritten on the next deploy and may silently ship broken code.

---

## Deploy Reference (one table, one source of truth)

**Golden rule:** Web App deployments are **frozen snapshots**. `npm run rollout` / `push-api` push SOURCE but the live Web App serves the last DEPLOYMENT. You must run the matching `deploy-*` command after every push to Web App code. If in doubt, `npm run deploy-all`. See `_archive/Docs/Archive/Deployment_Reference.md` for full troubleshooting.

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

`npm run build` in `stride-gs-app/` now routes through `scripts/build.js` — a wrapper that replaces the raw `tsc -b && vite build` chain with four phases and two sanity checks. It exists because session 58 shipped three sessions worth of React changes into production as **stale echo bundles** (see `_archive/Docs/Archive/Session_History.md` session 59 for the forensics). The safeguards make that exact failure mode impossible to recur silently.

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

## GitHub Actions CI/CD

Workflows live in `.github/workflows/`. **Full docs:** `.github/workflows/README.md`.

### Current state (session 77): auto-deploy workflows disabled

`ci.yml` and `deploy.yml` were renamed to `ci.yml.disabled` / `deploy.yml.disabled` after intermittent transport-layer failures on the Actions runner were leaving `origin/main` behind the `source` branch silently. GitHub Actions only picks up `.yml` / `.yaml` files in `workflows/`, so the `.disabled` suffix turns them off without deleting the carefully-wired YAML (including Secrets bindings). Re-enable by renaming back once the transport issues are resolved.

`migrate.yml` is still active — it's `workflow_dispatch` (manual-trigger only) so it doesn't run on push. Useful as an alternative to the MCP `apply_migration` when you want an approval-gated migration run.

### Workflow inventory

| File | State | Trigger | What it does |
|------|-------|---------|--------------|
| `ci.yml.disabled` | DISABLED | (would fire on push to `source`) | `npm ci` → `tsc -b` → `npm run build` → bundle size report |
| `deploy.yml.disabled` | DISABLED | (would fire on push to `source`) | Build + force-push `dist/` to `origin/main` via `peaceiris/actions-gh-pages@v4` |
| `migrate.yml` | ACTIVE | `workflow_dispatch` (manual only) | Display SQL + `supabase db push` if confirm=true |

### Re-enabling later

If you want to try Actions again:
1. `git mv .github/workflows/deploy.yml.disabled .github/workflows/deploy.yml` (+ same for ci).
2. Verify the three Secrets are still set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`.
3. Make a small React change and push — watch the Actions tab.
4. If the run fails (particularly with schannel / TLS errors or "force-push succeeded but `origin/main` didn't advance"), rename them back to `.disabled` and keep using `npm run deploy`.

### Required GitHub Secrets (still set)

Set in: **GitHub → Settings → Secrets and variables → Actions**

| Secret | Used by (when enabled) |
|--------|---------|
| `VITE_SUPABASE_URL` | `ci.yml`, `deploy.yml` (Vite build) |
| `VITE_SUPABASE_ANON_KEY` | `ci.yml`, `deploy.yml` (Vite build) |
| `SUPABASE_DB_URL` | `migrate.yml` (PostgreSQL connection string) |

`GITHUB_TOKEN` is auto-provided — no setup needed.

### Migration workflow (Claude agents)
For production migrations with an approval gate, trigger via CLI:
```bash
gh workflow run migrate.yml \
  -f migration_file=stride-gs-app/supabase/migrations/YYYYMMDDHHMMSS_name.sql \
  -f confirm=true
```
During development, prefer the MCP `apply_migration` tool (faster, no approval gate needed).

### Client rollout — still manual
No automation for `npm run rollout && npm run deploy-clients` — intentionally gated. When CLAUDE.md instructs a rollout, run it directly from `AppScripts/stride-client-inventory/`.

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

## Modules Partially Ported from WMS

The Stride WMS web app (separate React/Supabase project, `_archive/_wms_reference/` in this repo) has been the staging ground for several cross-app components. Where a module is worth reusing, we port the implementation down to GS rather than rebuild from scratch — but most ports are **partial**, either because a dependency doesn't exist here or because the GS workflow has different constraints. This section tracks what's landed and what still lives in WMS-only form.

**Fully ported (feature-complete in GS, no open items):**

- **`MultiPhotoCapture` → `MultiCapture`** — session 75. Shared "take many, save once" camera flow that queues photos/documents locally and saves them all in one batch. GS version is mode-agnostic (`photo` | `document`) and sequential-upload (WMS was `Promise.all` — too brittle for warehouse mobile networks). Wired into `PhotoUploadButton`, `DocumentScanButton`, `EntityAttachments.DocumentsSection`, and `ReceivingRowMedia`. GS file: [MultiCapture.tsx](stride-gs-app/src/components/media/MultiCapture.tsx). WMS reference: `_archive/_wms_reference/stride-wms-app-main/src/components/common/MultiPhotoCapture.tsx`.
- **`QRScanner`** — session 69 Phase 3. Camera-based barcode scanner with `BarcodeDetector` primary path + `html5-qrcode` fallback. Ported nearly 1:1; only change was stripping the WMS-specific device-selection UI. GS file: [QRScanner.tsx](stride-gs-app/src/components/scanner/QRScanner.tsx).
- **`DeepLink` + query-param routing** — ported pattern, not a single file. GS's query-param deep links (`?open=<id>&client=<sheetId>`) are the proven shape over WMS's route-style URLs; WMS still uses the route-style form for its own pages.

**Partially ported (stub exists but missing a key capability):**

- **Document Scanner** — `DocumentScanButton` (session 75) captures a single JPEG per scan and uploads as a document. The WMS version has multi-page PDF assembly with B&W threshold + edge detection. GS currently lacks those post-processing steps — users scanning a multi-page BOL get N separate JPEG docs instead of one PDF. Planned: port `pdf-lib` + simple threshold filter. Not blocking; operators currently upload multi-page files directly via the file picker when they need PDF output.
- **OCR on uploaded documents** — WMS runs Tesseract.js on document uploads and stores the extracted text in `documents.ocr_text` (the column exists in GS's `documents` table already — see session 73 migration). GS never wires up the client-side OCR step; `ocr_text` is always NULL in GS. Nothing depends on it today (no search UI surfaces it), so this is deferred until search gains OCR scope.
- **Drag-to-reorder (labels + price list rows)** — WMS uses `@dnd-kit/sortable` for label field ordering and price-list row reordering. GS's [Labels.tsx](stride-gs-app/src/pages/Labels.tsx) has up/down buttons only; PriceList currently relies on the `display_order` column for sort (no drag UI). Both are functional but less slick. `@dnd-kit` is not in GS's dependency tree — adding it is cheap but every page that would benefit needs wiring separately.
- **Print label preview canvas** — WMS renders the label to an HTMLCanvas for pixel-accurate WYSIWYG. GS does HTML-to-print via `@media print` CSS, which is close but drifts at edge cases (very long item descriptions, thumbnail QR sizes). Good-enough for daily use.

**WMS-only (not ported, probably never will be):**

- **`AccountPricingTab` / per-tenant rate overrides** — GS has a single Master Price List for all clients; per-client overrides happen via the `DISCOUNT_STORAGE_PCT` / `DISCOUNT_SERVICES_PCT` settings keys, not a rate-override table. No demand to port this.
- **`EditAdjustmentDialog`** — WMS adjustment flow ties into its `adjustments` table which doesn't exist in GS.
- **`StocktakeManifest` / inventory cycle count** — GS does cycle counts via the Scanner + Move History audit log, not a dedicated manifest flow.
- **`get_effective_rate` Postgres function** — WMS's Supabase-resident rate lookup. GS's `api_lookupRate_` lives in GAS today and is mid-cutover to Supabase (Phase 5 shadow mode). Different shape; separate evolution.

When porting from WMS: always check `_archive/_wms_reference/` first to save the reimplementation time, but be prepared to adapt. WMS uses shadcn/ui + Tailwind + `date-fns`; GS uses inline styles + v2 theme tokens + native `Intl.DateTimeFormat`. A straight copy-paste rarely compiles.

---

## Cross-tab Realtime Sync — end-to-end data flow

When a user edits anything that's surfaced on multiple pages (or open in multiple tabs / different browsers), the change propagates everywhere within **~1-2 seconds, zero manual refresh**. Completed in session 72 (Phase 1a + Phase 2). Here's how it actually works:

### 1. Write path (browser A → Google Sheet → Supabase)

```
React Inventory page edit
   ↓ optimistic patch (useInventory.applyInventoryPatch)  — paints instantly
   ↓ POST /exec?action=updateInventoryItem (apiFetch)
   ↓
StrideAPI.gs doPost router case
   ├─ handler writes Inventory sheet (authoritative)
   ├─ handler writes fan-out rows if any (Tasks/Repairs with matching Item ID)
   │                                     ↑ invariant #27: Inventory = source of truth for item fields
   ├─ router: invalidateClientCache_ (CacheService TTL key)
   ├─ router: api_writeThrough_(r, "inventory", clientSheetId, itemId)
   │     └─ resyncEntityToSupabase_ reads back the row from the sheet and upserts
   │        to public.inventory via sbInventoryRow_. Best-effort per invariant #20.
   ├─ handler: resyncEntityToSupabase_("task"|"repair", …) for each fan-out row
   │     (Phase 1a fix — router only mirrors the primary entity, handler mirrors the fan-out)
   └─ return { success: true }
```

Every write handler (update / complete / cancel / start / batch) is wrapped by
`api_writeThrough_` OR calls `api_fullClientSync_` OR has an inline
`resyncXToSupabase_(...)` call. Verified in session 72 Phase 1a audit — see
`_archive/Docs/Stride_GS_App_Build_Status.md` for the full per-handler table.

### 2. Supabase Realtime broadcast

Supabase's postgres_changes publisher fires a WebSocket event on every
INSERT/UPDATE to the read-mirror tables.

Publisher enabled on these tables (see migrations + `REPLICA IDENTITY FULL`):
`inventory, tasks, repairs, will_calls, shipments, billing, clients, claims,
move_history (INSERT-only), dt_orders, locations`.

### 3. Read path (Supabase → every open browser tab)

```
src/hooks/useSupabaseRealtime.ts   ← mounted once in AppLayout
   ↓ single channel "stride_cache_realtime"
   ↓ 20+ listeners (INSERT + UPDATE per table)
   ↓ 500ms debounced coalesce per entity-type (bulk moves = 1 refetch, not N)
   ↓
src/lib/entityEvents.ts
   ↓ emitFromRealtime('inventory'|'task'|'repair'|…, entityId)
   ↓ (does NOT set skipSupabase flag — SB has the fresh row, refetch from there)
   ↓
src/hooks/useInventory.ts / useTasks.ts / useRepairs.ts / useWillCalls.ts /
useShipments.ts / useBilling.ts / useClaims.ts / useOrders.ts / useClients.ts
   ↓ entityEvents.subscribe((type) => if (type === '…') refetch())
   ↓ Supabase-first fetch via fetchXFromSupabase (~50ms), with GAS fallback
   ↓ list page re-renders; detail panel if open re-renders
```

Other-tab user **sees the new value in ~1-2s** with no button press. Same mechanism means **tab B updates even when tab A is on a different page** — any hook mounted anywhere in the tree listens.

### 4. Why the local-tab optimistic patch doesn't fight the Realtime echo

When tab A writes, it:
1. Paints its own optimistic patch immediately (0ms)
2. Fires the GAS POST
3. Receives the Realtime echo for its own write ~1s later

Step 3's payload usually equals what step 1 already painted, so the re-render is a no-op. If there were divergence (server added `updated_at`, `updatedBy`, etc.), the server values win — which is what we want. **No writeId / idempotency-token mechanism needed** unless flicker is observed (none reported to date).

### 5. What's NOT in Realtime

- **Autocomplete DB** (per-client sidemark/vendor/description lists) — not mirrored to Supabase; still GAS.
- **Move_history**: INSERT-only subscription; no UPDATE/DELETE (it's an append-only audit log).
- **Stax tables** (invoices/charges/etc.) — mirrored to Supabase via write-through but NOT yet Realtime-subscribed (Payments page still uses explicit refresh button). Phase 3 if needed.
- **Email templates, cb_users, marketing_contacts/campaigns** — mirrored, Realtime wiring could be added but not driven by user demand yet.

### 6. Failure modes and what to check

| Symptom | Likely cause |
|---|---|
| Edit shows on Google Sheet but **never** in React on another tab | Supabase write-through failed silently. Check Apps Script execution log for `sb_mirror: <entity> … fail` or `api_writeThrough_ SYNC FAILED`. Or check `gs_sync_events` table for the entity. |
| Edit propagates but takes >10s | Supabase Realtime connection might be dropped. Check DevTools → Network → WS tab for an active `stride_cache_realtime` channel. |
| Bulk receive of 20 items fires 20 rapid re-renders | Check the 500ms debounce in `useSupabaseRealtime.ts` — every entity-type should be throttled. |
| Fan-out field (Location on Tasks) stale after Inventory edit | Confirm `handleUpdateInventoryItem_` is on v38.72.0+ — earlier versions only mirrored the Inventory row, not the touched Task/Repair rows. |

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

## ⚠️ Deep Links — How They Work (DO NOT BREAK)

Email CTA buttons ("View in Stride Hub") link to the React app and auto-open the correct entity detail panel. This has broken multiple times — **read this before touching any deep-link code.**

### The correct URL format

**All deep links MUST use query-param style on the LIST PAGE with `&client=`:**
```
https://www.mystridehub.com/#/tasks?open=INSP-62391-1&client=<spreadsheetId>
https://www.mystridehub.com/#/repairs?open=RPR-00123&client=<spreadsheetId>
https://www.mystridehub.com/#/will-calls?open=WC-00456&client=<spreadsheetId>
https://www.mystridehub.com/#/shipments?open=SHP-001234&client=<spreadsheetId>
https://www.mystridehub.com/#/inventory?open=62391&client=<spreadsheetId>
```

### Why this format and not route-style (`/#/tasks/INSP-62391-1`)

Route-style URLs (`/#/tasks/INSP-62391-1`) go to standalone `TaskJobPage.tsx` which fetches a single task from Supabase. **This path was unreliable** — clicking from Gmail, the `#` fragment was being stripped by Gmail's link tracker, so users landed on the list page with no context. The query-param format always lands on the list page, which has deep-link handlers that:
1. Read `?open=` → store in `pendingOpenRef`
2. Read `?client=` → store in `deepLinkPendingTenantRef`
3. When `apiClients` loads → auto-select the client in the dropdown
4. When data loads → auto-open the detail panel for the matching entity

**Without `&client=`**, step 3 never fires → no client selected → no data fetched → detail panel never opens. **This is the most common breakage mode.**

### Where deep-link URLs are built (TWO systems — both must have `&client=`)

| System | Where | Token | Notes |
|---|---|---|---|
| **Client-bound scripts** | `Emails.gs`, `Triggers.gs`, `Shipments.gs` | `{{APP_DEEP_LINK}}` | Builds the URL explicitly with `encodeURIComponent(ss.getId())`. The `sendTemplateEmail_` function injects it as a CTA button before `</body>`. |
| **StrideAPI.gs** | `api_sendTemplateEmail_` (line ~9148) | `{{TASK_DEEP_LINK}}`, `{{REPAIR_DEEP_LINK}}`, `{{WC_DEEP_LINK}}`, `{{SHIPMENT_DEEP_LINK}}`, `{{ITEM_DEEP_LINK}}` | Auto-injected from entity ID tokens. Uses `APP_BASE_URL_` (`https://www.mystridehub.com/#`) + `&client=` suffix from `settings["CLIENT_SPREADSHEET_ID"]`. |

### Rules for future builders

1. **Never use route-style deep links** (`/#/tasks/ID`) — always use query-param style (`/#/tasks?open=ID&client=SHEET_ID`).
2. **Always include `&client=<spreadsheetId>`** in the URL. The spreadsheet ID comes from `ss.getId()` in client-bound scripts, or `settings["CLIENT_SPREADSHEET_ID"]` in StrideAPI.gs.
3. **Don't change `APP_BASE_URL_`** in StrideAPI.gs — it must include the `#` (`https://www.mystridehub.com/#`).
4. **The React deep-link handler** lives in each list page (Inventory, Tasks, Repairs, WillCalls, Shipments) as two effects: one reads URL params on mount, the other resolves the client when `apiClients.length` changes. The dependency must be `[apiClients.length]` (a stable number), NOT `[apiClients]` (unstable array ref → React #300).
5. **`useClientFilterUrlSync`** hook keeps the URL's `?client=` param in sync with the dropdown — so when a user picks a client manually, the URL becomes shareable/bookmarkable.

---

## Load-bearing Architectural Invariants

These are the top decisions that affect code generation on every task. For the full 53-item list with implementation notes, see `_archive/Docs/Archive/Architectural_Decisions_Log.md`.

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
27. **Inventory is the single source of truth for all item-level fields** (session 70). All 22 Inventory columns are mapped via `api_buildInvFieldsByItemMap_(ss)` in StrideAPI.gs. Every handler (Tasks, Repairs, Will Calls, Billing, Batch/Dashboard) OVERRIDES Location/Vendor/Sidemark/Description/Room/Shipment#/etc. from Inventory at read time — NOT blank-backfill. On the Supabase side, `_fetchInvFieldMap()` in supabaseQueries.ts does the same overlay for `fetchTasksFromSupabase`, `fetchRepairsFromSupabase`, `fetchDashboardSummaryFromSupabase`. This means: Scanner moves an item → ALL pages show the new location immediately. Edit an item's vendor on Inventory → Tasks/Repairs/WC/Dashboard all reflect it. **Never store item-level data on entity tabs and expect it to stay current — always read from Inventory.**
26. **`useClients` is a per-consumer hook, mitigated by in-memory cache + ref pattern** (session 63 revert). A `ClientsProvider` Context singleton was attempted in session 63 and reverted — it cleared the ~7-instance divergence but introduced a React #300 on client-filter click under the minified production build (cause never isolated; likely interaction between the conditional `useContext` fallback and consumer lifecycles across auth transitions). Current state: each consumer (page + 8 data hooks) calls `useClients()` independently, but all instances short-circuit on the in-memory `cacheGet` tier after the first fetch, so array references converge in practice. The **load-bearing mitigation for the Inventory React #300** is the `clientNameMap` ref-stabilization pattern in the 6 data hooks (`useInventory`/`useTasks`/`useRepairs`/`useWillCalls`/`useShipments`/`useBilling`) — always use the ref pattern when a hook builds a memo from `clients` and closes over it in a `useCallback` dep array. A cleaner singleton refactor is on the open-items list but not urgent.

---

## Current Versions

- **StrideAPI.gs:** v38.101.0 — sessions 73-77 mega build. Carries (reverse-chronological): DOC_QUOTE Supabase-backed Quote PDF generation + template token audit across every workflow (invoice / quote / work-order / welcome / onboarding / claim emails — two token-emission bugs fixed), messaging endpoints aligned with Supabase schema (sender/recipient joins via auth.uid()), email templates + doc templates moved to Supabase with GAS read-through + CacheService cache, `seedEmailTemplatesToSupabase` one-shot admin endpoint + auto-seed on first `handleGetEmailTemplates_` empty read, manual billing charges (`addManualCharge` / `voidManualCharge` / edit via extended `updateBillingRow` for MANUAL-* rows), Reference column + Sidemark propagation across billing pipeline (writes, reads, IIF memo, Supabase mirror), add-on services on receiving (server writes one billing row per checked add-on at shipment completion), Phase 5 rate cutover helpers + Rate Parity Monitor endpoint (shadow mode — sheet still primary), `api_lookupRateFromSupabase_` + `api_loadClassVolumesFromSupabase_` + `api_getTemplateFromSupabase_` with 600s CacheService, task due date + 2-tier priority (`updateTaskDueDate`, `updateTaskPriority`, `api_ensureTaskColumns_`), `resyncClients` full reseeder + script-id rediscovery paths, `handleAdminSetUserPassword_` + `handleEnsureAuthUser_` + `handleResyncUsers_`. Still carries session-70/69 Room→Reference swap, repair notes save-before-start, payment terms endpoint.
- **Supabase schema:** session 73 Phase A applied six new tables — `item_photos`, `documents`, `entity_notes`, `messages`, `message_recipients`, `in_app_notifications` — plus `photos` and `documents` private storage buckets with tenant-scoped path RLS. `email_templates` + `email_templates_audit` live (session 73 Phase 6). `service_catalog` + `service_catalog_audit` live with 31 seeds (session 73 Price List). `expected_shipments` live (session 72). Every new table in the `supabase_realtime` publication.
- **React bundle:** `index-BjQQczFO.js` — session 76 Receiving TanStack rebuild; prior session 75 delivery zones + Zip Codes category in Price List, role-aware messaging recipient filter, messaging thread header with participant subtitle + clickable entity deep-link chip (resolves tenant from Supabase + appends `&client=` per CLAUDE.md rule), free-text Carrier in Add Shipment modal, optimistic calendar sync buses + pending pill. See `_archive/Docs/Stride_GS_App_Build_Status.md` for the detailed delta list.
- **StaxAutoPay.gs:** v4.6.0 — session 69 Phase 2f: Supabase write-through at end of `_prepareEligiblePendingInvoicesForChargeRun` (invoices + run log) and `_executeChargeRun` (invoices + charge log + exceptions + run log). **Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY Script Properties on the Stax Auto Pay project** — see open items.
- **Triggers.gs (client):** v4.7.1 — session 70: VIEW INSPECTION PHOTOS button in REPAIR_QUOTE email now opens the Source Task folder (looks up task row in Tasks sheet and reads Task ID cell's hyperlink, set by `startTask_` to the task's Drive folder). Previously fell back to the Item folder because Source Task ID stores plain text, not a hyperlink.
- **Import.gs (client):** v4.3.0 — adds Reference column mapping (rolled out to all 49 active clients, session 70)
- **Emails.gs (client):** v4.6.0 — session 70 continued: Room column dropped from `buildItemsHtmlTable_` and `buildSingleItemTableHtml_`, Reference takes its place (rolled out to all 49 active clients)
- **WillCalls.gs (client):** v4.3.0 — Item ID / Vendor / Description / Reference columns on completed-WC email
- **RemoteAdmin.gs (client):** v1.5.1 — adds `get_script_id` action; writes own scriptId to CB Clients SCRIPT ID column
- **Code.gs (client):** v4.6.0 (rolled out to all 49 active clients)
- **StaxAutoPay.gs:** v4.5.0
- See `_archive/Docs/Stride_GS_App_Build_Status.md` for the full per-script version matrix and session history.

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
**Phase 8 (Additional Features):** mostly complete — see `_archive/Docs/Stride_GS_App_Build_Status.md` for the full matrix

### Sessions 65+ shipped (2026-04-17 → 2026-04-20)

- [x] **Quote Tool page** — admin-only `/quote`, 18 components, `EST-NNNN` numbering, Supabase `service_catalog`-backed pricing matrix + coverage tiers, Supabase `DOC_QUOTE` template drives the printed PDF.
- [x] **Unified Price List page** — split-panel layout, inline edit, sortable column headers, show/hide inactive, service time per class (XS–XXL), Storage Size per class exposed, shareable public `/rates/:shareId` URLs with per-tab selection and no-login access.
- [x] **Billing — Supabase-first report builder** — no auto-load; client select fetches sidemarks only; Load Report runs the query; Refresh forces GAS; "+ Add Charge" creates `MANUAL-*` rows (add / edit / void) with detail panel actions.
- [x] **Expected / Operations Calendar** — primary Dashboard tab, unified event feed (tasks, repairs, will calls, expected shipments), priority-sorted per day, deep links on every event type, 4 aggregate stat cards, Mon-start weeks, free-text UNKNOWN shipments (staff-only), calendar search input, optimistic sync via per-entity sync buses + `pending` pill state.
- [x] **Media modules** — `item_photos`, `documents`, `entity_notes` tables + `photos` / `documents` private storage buckets (tenant-scoped path RLS). `PhotoGallery` / `DocumentList` / `NotesSection` wired into every detail panel (Item / Task / Repair / Will Call / Shipment) via shared `EntityAttachments` wrapper with collapsible section headers + live counts.
- [x] **Messaging** — `messages` + `message_recipients` tables, iMessage-style bubble UI (blue/gray, thread isolation), compose modal with role-aware recipient picker (clients see admin + same-account coworkers only), deep-link entity chips on every thread header that resolve tenant + append `&client=`, persistent unread banner at top of layout, TopBar bell with `useMessages.unreadCount`-driven badge (notifications module retired, simplified to pure Messages quick-link).
- [x] **Email templates → Supabase** — `email_templates` + `email_templates_audit`, GAS `api_getTemplateFromSupabase_` with 600s `CacheService`, auto-seed from MPL on first empty read, `handleUpdateEmailTemplate_` writes Supabase + mirrors to MPL. Settings → Email Templates writes direct to Supabase with audit. `npm run push-templates` + `refresh-caches` remain as backup paths, no longer required for everyday edits.
- [x] **Doc templates → Supabase** — work orders, invoice, quote, claim settlements — all Supabase-backed, editable from Settings → Templates, `Test Generate` button per template. Token audit across all 6 workflows; two emission bugs fixed.
- [x] **Task due date + 2-tier priority** — `updateTaskDueDate`, `updateTaskPriority`, `api_ensureTaskColumns_` idempotent header add. Overdue rows highlight red; calendar lifts task `priority` into sort + "High Priority" stat card. SLA auto-populates due date from service default when a task is created.
- [x] **Receiving add-ons** — expandable per-row checkboxes for OVER300/NO_ID/etc. Local-state only during editing; billing rows created server-side in `handleCompleteShipment_` from the `addons` array. Auto-apply rules: overweight by `weight > OVERWEIGHT_THRESHOLD`, `no_id` triggers when client matches "Needs ID Holding Account". Per-item `dismissedAddons` set prevents re-check after manual override.
- [x] **Phase 5 billing rate cutover (shadow mode)** — `api_lookupRate_` + `api_loadClassVolumes_` + `handleGetPricing_` query Supabase `service_catalog` / `item_classes` in parallel with the sheet, log `PARITY_OK` / `PARITY_MISMATCH` lines. Sheet is still primary (authoritative) — flip to Supabase-primary pending parity review. Rate Parity Monitor tab in Billing page surfaces live divergence.
- [x] **Profiles + user directory** — `profiles` table, 137 users loaded via auto-sync trigger off `auth.users`, powers messaging recipient picker + `@mentions`.
- [x] **Sidemark + Reference columns in billing pipeline** — write-through on every billing-row create, read-time overlay from Inventory as fallback, backfilled 304 prior rows, propagated through QB IIF memo.
- [x] **Visual refresh Phase 1 + full v2 pass** — `theme.v2` applied to all 20 routes + 4 job pages + shared components (Sidebar v2, Quote Tool pattern as seed).
- [x] **Full mobile pass on staff pages** — iOS safe areas, 44px touch targets, full-screen drawers, scrollable tab bars, thumb-reachable controls on Dashboard / Calendar / Receiving / Inventory / Tasks / Repairs / WillCalls / Shipments / Messages.
- [x] **Receiving page media** — inline photos + documents + notes during receiving via `ReceivingRowMedia`; notes column on Inventory reads `entity_notes` via `useItemNotes` batch hook; old sheet-based notes migrated into `entity_notes`.
- [x] **Auth + bug fixes** — auto-inspect race (`useMemo` + guarded `useEffect`), expired reset link UX (`recovery_expired` auth state), mobile sidebar logout clip (100vh → 100% + `overflow: hidden`), `useApiData` background refresh cache bug, `useClients` referential-instability ref pattern, Will Calls multi-row select, autocomplete sidemark/room mix, 12 clients with template scriptId.
- [x] **DispatchTrack Phase 1b** — Orders tab live (admin-only, empty until Phase 1c ingest).
- [x] **DispatchTrack Phase 1a migration** — schema applied to Supabase.
- [x] **GitHub Actions CI/CD** — `ci.yml`, `deploy.yml`, `migrate.yml` all live with secrets configured.
- [x] **Master Inventory Template Web App deployment** — `!c.isTemplate` guard removed from `update-deployments.mjs`, template has Web App v108.
- [x] **Admin-set-password escape hatch + auth user ensure** — `handleAdminSetUserPassword_`, `handleEnsureAuthUser_`, `handleListMissingAuthUsers_`, `handleResyncUsers_`.
- [x] **Scanner + Labels Supabase direct** — item_id_ledger cross-tenant resolution, locations mirror, `batchUpdateItemLocations` with central `move_history` audit.
- [x] **Delivery zip codes in Price List (session 75)** — 398 zones seeded into `delivery_zones` via `20260420100000_delivery_zones.sql` (extends the pre-existing Quote Tool table). New `Zip Codes` pseudo-category in the PriceList sidebar with inline-edit table, Add Zip modal, search, stats, Realtime. Excel export gets a new `Delivery Zones` sheet. Share modal's "Include zip code schedule" toggle is live; public `/rates/:shareId` renders a zones tab (anon-read RLS restricted to `active=true`).
- [x] **Messaging role-aware recipient filter (session 75)** — clients only see admin + same-account coworkers in Compose picker; broadcast pills hidden for client role; staff/admin unchanged. Joins profiles with cb_users to resolve each profile's `clientSheetId`.
- [x] **Messaging thread header (session 75)** — WhatsApp-style: title on top, comma-separated participant names underneath (resolved from thread senders + recipients via profiles), right-side entity deep-link chip that opens in a new tab. Chip renders unconditionally; `&client=<tenant>` appended once a Supabase lookup resolves the entity's tenant (`item_id_ledger` for inventory, `tasks`/`repairs`/`will_calls`/`shipments` for the rest).
- [x] **Free-text Carrier in Add Shipment (session 75)** — `<input list="carrier-suggestions">` with a `<datalist>` replaces the `<select>`. Preset carriers remain as quick picks; any custom string accepted.
- [x] **Optimistic calendar across entities (session 74/75)** — per-entity module sync buses on `useTasks` / `useRepairs` / `useWillCalls` broadcast optimistic TEMP- rows across every hook instance. Calendar pills render with dashed border + ~60% opacity + pulsing dot while syncing; `stridePulse` keyframe in `index.css`. Reconcile by composite key when real row arrives.

### Still open

- [ ] **Quote Tool PDF wire-up** — Quote PDF generation using Supabase `DOC_QUOTE` template (in progress — React end next).
- [ ] **DispatchTrack Phase 1c** — webhook ingest Edge Function. Needs DT account API credentials + webhook secret.
- [ ] **Phase 5 billing cutover flip** — shadow mode is currently logging parity. Switch to Supabase-primary once operator reviews the mismatch log on Justin Demo Account and confirms zero drift.
- [ ] **GitHub migration — move repo out of Dropbox** — repo is already on GitHub, but the local clone lives in Dropbox. Move the clone to a non-synced local path to end the Dropbox write-conflict category of bugs.
- [ ] **Standalone Repair / Will Call detail pages** — `#/repairs/:repairId` and `#/will-calls/:wcNumber` — same pattern as Task Detail, not started.
- [ ] **Generate Work Order button** — Manual PDF from TaskDetailPanel. Backend handler exists; needs React wiring + router case.
- [ ] **Seed Stax Supabase caches (one-time)** — Open Stride API editor → run `seedAllStaxToSupabase()` once. Until then Payments falls back to GAS on first load.
- [ ] **Set Supabase Script Properties on Stax Auto Pay project** — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on the Stax project. Until set, write-through is a silent no-op.
- [ ] **Auto-Print Labels from Receiving** — toggle for inline label printing during receiving.
- [ ] **Parent Transfer Access** — allow parent users to transfer items between their own children.
- [ ] **Global search expansion** — add shipments / billing / claims entities + missing fields.
- [ ] **Autocomplete DB in React** — Sidemark / Vendor / Description per client.
- [ ] **Invoice-level `invoiceDate` field** — add to `InvoiceGroup` so re-sorted children don't shift the displayed date.
- [ ] **Invoice number link in summary row** — wire `invoiceUrl` through `InvoiceGroup`.
- [ ] **DetailPanel internals v2 polish** — outer panel is v2, deep interiors (action rows, field grids) still have 8–10px corners.
- [ ] **Sync delivery zones to MPL sheet tab** — data now lives in Supabase; bidirectional mirror to the MPL zip-code tab is deferred (not blocking any workflow since there is no GAS consumer of that tab today).

### Known bugs (unresolved)

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
- **`_archive/Docs/Stride_GS_App_Build_Status.md`**: current session changes (REPLACE each session — do not accumulate), feature matrix, what's next

### Cold docs (update rarely, only when scope shifts)
- **`_archive/Docs/Archive/Session_History.md`**: add one-line entry per session
- **`_archive/Docs/Archive/Architectural_Decisions_Log.md`**: add new numbered decision when one is made; trim nothing
- Other archive files: update when the feature/phase they describe gets a major change

### Trimming rules
- Session entries in CLAUDE.md "Current Phase & Open Work" → only open items, never `[x] done`
- Completed phase plans → move the full plan to `_archive/Docs/Archive/`, leave a one-liner in CLAUDE.md
- Known bugs: remove once fixed and deployed
- Never expand session history into full changelogs — keep it one line per session, max ~200 chars
