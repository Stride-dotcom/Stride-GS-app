# GitHub Actions Workflows

Two workflows — both **manual-trigger only**. Nothing fires automatically.

Deploys are done locally via `npm run deploy` (see `stride-gs-app/scripts/deploy.js`). There is no auto-deploy pipeline.

---

## Workflows

### 1. `ci.yml` — CI (typecheck + build)

**Trigger:** Manual only (`workflow_dispatch`) — GitHub Actions UI or:
```bash
gh workflow run ci.yml
```

**What it does:**
1. Installs Node 20 + `npm ci`
2. Runs `npx tsc -b` (strict TypeScript project check)
3. Runs `npm run build` (full `verify-entry → tsc → vite → module-count → bundle-size` pipeline)
4. Reports bundle filename + size in the job summary

**Purpose:** On-demand sanity check — typecheck and build without deploying. Useful for verifying a branch from CI's perspective (e.g. matches what would run on a teammate's machine) or when you don't have Node 20 installed locally.

**Secrets required (only for build to embed Supabase URL):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Typecheck works without these; only the build embeds them.

---

### 2. `migrate.yml` — Apply Supabase Migration

**Trigger:** Manual only (`workflow_dispatch`) — GitHub Actions UI or:
```bash
gh workflow run migrate.yml \
  -f migration_file=stride-gs-app/supabase/migrations/20240101000000_add_column.sql \
  -f confirm=true
```

**What it does:**
1. Displays the SQL file in the job summary (always — for audit trail)
2. If `confirm=false`: exits cleanly (dry-run / preview)
3. If `confirm=true`: installs Supabase CLI and runs `supabase db push --db-url` to apply all pending migrations from `stride-gs-app/supabase/migrations/`

**Secrets required:**
- `SUPABASE_DB_URL` — PostgreSQL connection string
  - Format: `postgresql://postgres:[password]@db.uqplppugeickmamycpuz.supabase.co:5432/postgres`
  - Find password: Supabase dashboard → Settings → Database → Connection string → URI

---

## Required GitHub Secrets

Set in: **GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Used by | Where to find |
|--------|---------|---------------|
| `VITE_SUPABASE_URL` | `ci.yml` | `.env` file in `stride-gs-app/` |
| `VITE_SUPABASE_ANON_KEY` | `ci.yml` | `.env` file in `stride-gs-app/` |
| `SUPABASE_DB_URL` | `migrate.yml` | Supabase dashboard → Settings → Database → URI |

---

## Deploys — local only

React deploys continue to use `npm run deploy` from `stride-gs-app/`:
```bash
cd stride-gs-app
npm run deploy -- "commit message"
```

This builds + pushes `dist/` to `origin/main` (GitHub Pages). No GitHub Action involved. The `dist/.git` subtree is the source of truth for production.

Client script rollout also stays local (`cd AppScripts/stride-client-inventory && npm run rollout && npm run deploy-clients`). No automation.

---

## Historical note

An auto-deploy workflow (`deploy.yml`) was added on 2026-04-17 but immediately broke production because the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` secrets weren't configured in GitHub Actions → builds shipped with empty Supabase credentials → site crashed with `supabaseUrl is required`. The workflow was reverted and then deleted. Manual `npm run deploy` remains the only deploy path.
