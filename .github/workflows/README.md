# GitHub Actions Workflows

Three workflows automate the Stride GS Inventory CI/CD pipeline. All run against the `source` branch (the human-readable source branch; `main` is compiled-bundle-only for GitHub Pages).

---

## Workflows

### 1. `ci.yml` — Continuous Integration

**Triggers:** Any push to `source` or PR targeting `source` that touches `stride-gs-app/**`

**What it does:**
1. Installs Node 20 + `npm ci`
2. Runs `npx tsc -b` (strict TypeScript project check — same as pre-deploy)
3. Runs `npm run build` (the full `verify-entry → tsc → vite → module-count → bundle-size` pipeline)
4. Reports bundle filename + size in the job summary

**Purpose:** Catches type errors and build failures on PRs before merge. Build uses `scripts/build.js` — the same safeguarded pipeline that prevents stale-bundle regressions (see CLAUDE.md § React build safeguards).

**Secrets required:**
- `VITE_SUPABASE_URL` — used by Vite at build time (build succeeds without it but warns)
- `VITE_SUPABASE_ANON_KEY` — same

---

### 2. `deploy.yml` — Auto-Deploy to GitHub Pages

**Triggers:** Push to `source` (not PRs) touching `stride-gs-app/**`

**What it does:**
1. `npm ci` → `tsc -b` → `npm run build` (same as CI)
2. Verifies `dist/index.html` and `dist/assets/*.js` exist
3. Force-pushes `stride-gs-app/dist/` to `origin/main` via `peaceiris/actions-gh-pages@v4`

**Result:** `mystridehub.com` is live within ~2 minutes of a push to `source`. No manual `npm run deploy` needed.

**`force_orphan: true`** — each deploy is a fresh orphan commit on `main`, identical to the previous `git push origin main --force` pattern from `scripts/deploy.js`.

**Secrets required:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GITHUB_TOKEN` — automatically provided by Actions; needs `permissions: contents: write` (already set in the workflow)

---

### 3. `migrate.yml` — Apply Supabase Migration

**Triggers:** `workflow_dispatch` only (manual button in GitHub UI or CLI)

**What it does:**
1. Checks out repo and displays the specified SQL file in the job summary
2. If `confirm` is unchecked: exits cleanly (dry-run/preview)
3. If `confirm` is checked: installs Supabase CLI → runs `supabase db push --db-url` to apply all pending migrations from `stride-gs-app/supabase/migrations/`

**How to trigger from CLI (e.g. from a Claude agent):**
```bash
gh workflow run migrate.yml \
  -f migration_file=stride-gs-app/supabase/migrations/20240101000000_add_column.sql \
  -f confirm=true
```

**Secrets required:**
- `SUPABASE_DB_URL` — PostgreSQL connection string
  - Format: `postgresql://postgres:[password]@db.uqplppugeickmamycpuz.supabase.co:5432/postgres`
  - Find password: Supabase dashboard → Settings → Database → Connection string → URI

---

## Required GitHub Secrets

Set in: **GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Used by | Where to find |
|--------|---------|---------------|
| `VITE_SUPABASE_URL` | `ci.yml`, `deploy.yml` | `.env` file in `stride-gs-app/` |
| `VITE_SUPABASE_ANON_KEY` | `ci.yml`, `deploy.yml` | `.env` file in `stride-gs-app/` |
| `SUPABASE_DB_URL` | `migrate.yml` | Supabase dashboard → Settings → Database → URI |

`GITHUB_TOKEN` is provided automatically — no setup needed.

---

## Comparison: Old Manual Flow vs GitHub Actions

| Step | Before (manual) | After (GitHub Actions) |
|------|----------------|----------------------|
| React deploy | `cd stride-gs-app && npm run deploy -- "msg"` | Push to `source` → auto |
| TypeScript check | Part of `npm run deploy` | Also runs on every PR |
| GitHub Pages update | Force-push from `stride-gs-app/dist/.git` | `peaceiris/actions-gh-pages@v4` |
| Supabase migration | MCP tool `apply_migration` (still preferred for dev) | `migrate.yml` workflow_dispatch |

**The `dist/.git` subtree** (`stride-gs-app/dist/.git`) and `npm run deploy` still work for manual overrides. The Actions deploy and manual deploy write to the same `origin/main` and overwrite each other — both are valid paths.

---

## CLAUDE.md / Agent Instructions

When a Claude agent has made React changes and pushed to `source`, the deploy fires automatically — **no extra deploy command needed**.

For Supabase migrations, agents should continue to use the MCP `apply_migration` tool during development. Use the `migrate.yml` workflow for production migrations that need a paper trail or approval gate.

For client script rollout (`npm run rollout && npm run deploy-clients`), there is no automation workflow — this is intentional. Trigger it manually when CLAUDE.md instructs it:
```bash
# From AppScripts/stride-client-inventory/
npm run sync && npm run rollout && npm run deploy-clients
```
