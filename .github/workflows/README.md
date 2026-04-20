# GitHub Actions Workflows

Three workflows. **`deploy.yml` fires automatically on every push to `source`** — no manual deploy needed for React changes.

---

## Workflows

### 1. `ci.yml` — CI (typecheck + build)

**Trigger:** Push to `source` or PR targeting `source` (paths: `stride-gs-app/**`), plus `workflow_dispatch`.

**What it does:**
1. Installs Node 20 + `npm ci`
2. Runs `npx tsc -b` (strict TypeScript project check)
3. Runs `npm run build` (full `verify-entry → tsc → vite → module-count → bundle-size` pipeline)
4. Reports bundle filename + size in the job summary

**Secrets required:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

### 2. `deploy.yml` — Auto-deploy to GitHub Pages ⚡

**Trigger:** Push to `source` (no path filter — any push), plus `workflow_dispatch`.

**What it does:**
1. Installs Node 20 + `npm ci`
2. Builds with `npm run build` (full safeguard pipeline) with Supabase + API secrets injected
3. Reports bundle size in job summary
4. Force-pushes `stride-gs-app/dist/` to `origin/main` via `peaceiris/actions-gh-pages@v4` with `force_orphan: true`

**This replaces `npm run deploy`.** After pushing to `source`, GitHub Actions builds and deploys automatically. CDN propagates in 1–5 min; hard-refresh (Ctrl+Shift+R) to verify.

The `dist/.git` subtree and `npm run deploy` still work as a manual override if needed.

**Secrets required:**
- `VITE_SUPABASE_URL` ✅
- `VITE_SUPABASE_ANON_KEY` ✅
- `VITE_API_URL` — optional; falls back to hardcoded production GAS URL
- `VITE_API_TOKEN` — optional; falls back to `stride-prod-2026`

---

### 3. `migrate.yml` — Apply Supabase Migration

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
- `SUPABASE_DB_URL` ✅ — PostgreSQL connection string
  - Format: `postgresql://postgres:[password]@db.uqplppugeickmamycpuz.supabase.co:5432/postgres`

---

## Required GitHub Secrets

Set in: **GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Used by | Status |
|--------|---------|--------|
| `VITE_SUPABASE_URL` | `ci.yml`, `deploy.yml` | ✅ Set |
| `VITE_SUPABASE_ANON_KEY` | `ci.yml`, `deploy.yml` | ✅ Set |
| `SUPABASE_DB_URL` | `migrate.yml` | ✅ Set |
| `VITE_API_URL` | `deploy.yml` | Optional — has fallback |
| `VITE_API_TOKEN` | `deploy.yml` | Optional — has fallback |

`GITHUB_TOKEN` is auto-provided — no setup needed.

---

## Deploy flow summary

| Change type | Action | Deployed by |
|---|---|---|
| React source (`stride-gs-app/**`) | Push to `source` | `deploy.yml` auto-runs |
| GAS scripts | `npm run push-* && npm run deploy-*` | Local (manual, always) |
| Supabase migrations | MCP `apply_migration` or `migrate.yml` | MCP tool (preferred) |

---

## Historical note

An earlier `deploy.yml` was added on 2026-04-17 but broke production because the Supabase secrets weren't configured → builds shipped `undefined` for `VITE_SUPABASE_URL` → site crashed with `supabaseUrl is required`. That version was reverted and deleted.

The current `deploy.yml` (added 2026-04-18) uses the correct secrets (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) which are confirmed set. The `VITE_API_URL` / `VITE_API_TOKEN` use `|| 'fallback'` syntax so they never block a build if unset.
