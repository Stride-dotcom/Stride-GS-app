# Repo Structure & Branch Model

> **Status:** Canonical as of session 60. This is the one source of truth for
> how the GS Inventory repo is laid out on GitHub. Read this before pushing,
> branching, deploying, or opening PRs. If this document and reality disagree,
> reality is wrong and reality must be fixed — not the document.

---

## One remote, one source of truth

There is **exactly one GitHub repo** that holds the entire workspace:

**`https://github.com/Stride-dotcom/Stride-GS-app`**

Despite the name "Stride-GS-app" (which reflects its original React-only
scope), this repo holds the entire GS Inventory workspace as of session 60:
backend Apps Script, React app, docs, CLAUDE.md, everything. The name stays
put — renaming would break GitHub Pages and every cached git credential.

---

## Two local git repositories

After the session 59 cleanup, **two** `.git` directories exist in the
workspace on disk. Each has one clear job. If a third appears, something is
wrong — delete it.

| Path | Role | Remote branch(es) |
|---|---|---|
| `GS Inventory/.git` | **Parent repo** — all source code, docs, configs. This is where you commit during development. | `origin/source` + feature branches |
| `GS Inventory/stride-gs-app/dist/.git` | **Deploy subtree** — compiled React output. Force-pushed on every release. Do not edit manually. | `origin/main` |

Both point at the same GitHub remote URL.

**Do not** `git init` inside `stride-gs-app/` or `AppScripts/stride-client-inventory/`. If you see a `.git/` directory appear there, it's a regression — delete it.

---

## Branch model on the remote

```
origin/
├── main                    ← Built React bundle (HTML/CSS/JS). GitHub Pages
│                             serves from this branch. Force-pushed on every
│                             React deploy. NEVER merge source commits into
│                             main — main is dist artifacts only.
│
├── source                  ← DEFAULT BRANCH. Full parent workspace source
│                             of truth. All feature branches PR to this.
│
├── feat/warehouse/*        ← Warehouse / WMS feature branches
├── feat/delivery/*         ← Delivery / DispatchTrack feature branches
├── feat/fix/*              ← Hotfixes and small cleanups
│
└── (legacy branches)       ← feat/dt-phase1a, feat/dt-integration-phase1a-migration
                              are preserved for forensics but no longer active.
                              New work does not branch from these.
```

### Why this works

- **`main` is dist.** GitHub Pages serves a branch named `main` by default. We keep that. Our React deploy script force-pushes the built output to `main` via the `dist/.git` subtree repo. That flow is battle-tested and not changing.
- **`source` is source.** The parent workspace lives on `source`. All real development happens here. When you look at the GitHub repo in a browser, the "Code" tab should show `source` by default, not `main` — the `main` branch contains only compiled artifacts and is not useful to read as a human.
- **Feature branches branch from `source` and PR to `source`.** Never branch from `main` (that's built output, not source code).

### Setting `source` as the GitHub default branch

**One-time manual step** (I can't do this via CLI without `gh` installed, but it's a single checkbox):

1. Go to https://github.com/Stride-dotcom/Stride-GS-app/settings/branches
2. Find "Default branch" at the top
3. Click the switch/pencil icon → type or select `source` → click "Update"
4. GitHub will ask you to confirm the default-branch rename. Confirm.

That's it. After this, every PR compare link opens pre-set to target `source`, and the repo home page shows the source tree by default.

---

## Parallel development streams

The user explicitly wants to be able to ship warehouse-app changes while continuing to build delivery pages. This works cleanly with the branch model because both streams are just feature branches on the same `source` mainline.

### Stream A — Warehouse / WMS work

Everything that touches the existing warehouse app: inventory, shipments, tasks, repairs, will calls, billing, receiving, claims, settings.

**Branch naming:** `feat/warehouse/<short-description>`

Examples:
- `feat/warehouse/client-shipment-note`
- `feat/warehouse/release-items-bulk`
- `feat/warehouse/stax-autopay-tooltip`

### Stream B — Delivery / DispatchTrack work

Everything that touches the new delivery/customer-portal features: DT Phase 1c webhook ingest, Orders tab enhancements, delivery-status page, customer tracking portal.

**Branch naming:** `feat/delivery/<short-description>`

Examples:
- `feat/delivery/dt-phase1c-webhook-ingest`
- `feat/delivery/dt-phase1d-orders-enrichment`
- `feat/delivery/customer-tracking-portal`

### Stream C — Fixes

Small hotfixes or cleanups that don't belong to either stream.

**Branch naming:** `feat/fix/<short-description>` or `fix/<short-description>`

Examples:
- `fix/email-template-typo`
- `fix/dashboard-created-date-column`

### How the two streams stay out of each other's way

Streams A and B only conflict when they touch the **same file**. Since warehouse work and delivery work live in mostly separate file trees:

| Area | Stream A (warehouse) | Stream B (delivery) |
|---|---|---|
| `AppScripts/stride-api/StrideAPI.gs` | Both touch it | Both touch it — **conflict risk** |
| `AppScripts/stride-client-inventory/src/*.gs` | Warehouse only | — |
| `stride-gs-app/src/pages/{Inventory,Receiving,Tasks,…}.tsx` | Warehouse only | — |
| `stride-gs-app/src/pages/{Orders}.tsx` | — | Delivery only |
| `stride-gs-app/src/hooks/useOrders.ts` | — | Delivery only |
| `stride-gs-app/src/lib/supabaseQueries.ts` | Both (rare) | Both (rare) |
| `Docs/` | Both (rare) | Both (rare) |

**The one high-contention file is `StrideAPI.gs`** — the big backend file both streams edit. Normal git merge conflict resolution handles it, but the practical rule is: **merge each PR through as soon as it's ready, don't let feat branches stack up against `source` for days.** The longer a feat branch sits unmerged, the more StrideAPI.gs drift it has to rebase through.

If two PRs touching `StrideAPI.gs` are in review at the same time:
1. Merge the first one into `source`
2. Rebase the second one on top of the new `source` — git auto-resolves anything not touching the same function
3. Merge the second one

---

## Deployment flow

Unchanged from what's already in `CLAUDE.md` — this doc just clarifies the branch side.

### Backend (Apps Script)

| Target | Push | Deploy |
|---|---|---|
| `StrideAPI.gs` | `npm run push-api` (from `AppScripts/stride-client-inventory/`) | `npm run deploy-api` |
| Client scripts (`stride-client-inventory/src/*.gs`) | `npm run rollout` | `npm run deploy-clients` |
| Consolidated Billing | `npm run push-cb` | `npm run deploy-cb` |
| Stax Auto Pay | `npm run push-stax` | — |
| Master Price List | `npm run push-master` | — |
| Task Board | `npm run push-taskboard` | — |

**Apps Script deployments are frozen snapshots.** Push ≠ deploy. Always run the matching `deploy-*` command after `push-*` for any Web App–facing script (StrideAPI.gs, client scripts, CB). See `CLAUDE.md` Deploy Reference for full troubleshooting.

### Frontend (React)

```bash
cd stride-gs-app/
npm run build                                     # session-59 orchestrator: verify-entry → tsc → vite → sanity checks
cd dist/
git add -A
git commit -m "Deploy: <what changed>"
git push origin main --force                      # dist/.git targets main on Stride-GS-app
```

**Never `git push` from `stride-gs-app/`** — that's under the parent repo which pushes to `source`, not `main`. The `dist/` subdirectory has its own `.git/` that targets `main`.

**Always `npm run build`, never `npm run build:raw`.** The orchestrator catches the session-58 silent-stale-bundle failure mode. `build:raw` is an escape hatch that re-opens that vulnerability.

### Parent repo (source)

```bash
# From GS Inventory/ root
git checkout -b feat/warehouse/my-change          # or feat/delivery/..., feat/fix/...
# ... make changes ...
git add <specific files>
git commit -m "feat(warehouse): my change description"
git push -u origin feat/warehouse/my-change

# Open a PR:
# https://github.com/Stride-dotcom/Stride-GS-app/compare/source...feat/warehouse/my-change
# Click "Create pull request" in the browser.
# Merge from the web UI when ready.

# After merge, pull the new source locally:
git checkout source
git pull origin source
```

---

## Claude's workflow

When I'm working in this repo, here's what I will do going forward:

1. **Branch before writing code** — create `feat/warehouse/*` or `feat/delivery/*` before making edits, so the change is always on an isolated branch.
2. **Push the branch to origin** after committing — I have git credentials cached, no setup needed.
3. **Provide the PR compare URL** at the end of the task:
   ```
   https://github.com/Stride-dotcom/Stride-GS-app/compare/source...feat/warehouse/<branch-name>
   ```
4. **You click the link** and merge via the GitHub web UI. Two clicks.
5. **After merge**, I pull the updated `source` locally so subsequent work rebases cleanly.

### Full push + merge automation (optional)

To let me click Merge on your behalf so you never have to touch the web UI, install `gh` CLI once:

```powershell
winget install --id GitHub.cli -e
gh auth login
# → github.com, HTTPS, Y to authenticate Git, web browser, paste code, authorize
```

After that single 5-minute setup, I can run:
```bash
gh pr create --base source --head feat/... --title "..." --body "..."
gh pr merge <number> --squash --delete-branch
```

— and the entire push+merge loop runs end-to-end without you clicking anything.

**Without `gh`,** the flow still works — I push, give you the compare URL, you merge. You're in the loop for every merge. That's not a bad thing.

---

## What happens to the legacy branches

The following branches on the remote are **legacy** and no longer receive new commits:

- `origin/feat/dt-phase1a` — commits from the sparse nested-repo era, plus my session 59 build safeguards + orphaned src/ restoration commits. Preserved for forensics. New delivery work goes on `feat/delivery/*` instead.
- `origin/feat/dt-integration-phase1a-migration` — 2-file sparse state from the broken nested repo. Historical only.

These can be deleted at any time without losing anything — all their content is reflected in `source`. Leave them for now as a forensic trail if anyone ever asks "where did the session 58-59 regression history go".

---

## Health checks

Run these periodically to make sure the structure hasn't drifted:

```bash
# 1. Exactly two .git directories in the workspace (parent + dist)
find "C:/Users/expre/Dropbox/Apps/GS Inventory" -maxdepth 4 -name ".git" -type d
# Expected:
#   .../GS Inventory/.git
#   .../GS Inventory/stride-gs-app/dist/.git

# 2. Parent repo points at origin/source as its main tracked branch
cd "C:/Users/expre/Dropbox/Apps/GS Inventory"
git branch -vv
# source line should show: source <hash> [origin/source] <subject>

# 3. dist repo points at origin/main for GitHub Pages deploys
cd stride-gs-app/dist
git branch -vv
# main line should show: main <hash> [origin/main] Deploy: <subject>

# 4. No nested .git inside stride-gs-app (only in stride-gs-app/dist)
ls -la stride-gs-app/.git 2>&1
# Expected: "No such file or directory"

# 5. GitHub default branch is source
# (manual check: https://github.com/Stride-dotcom/Stride-GS-app/settings/branches)
```

If any of these fail, stop and fix the structure before committing new work. A broken repo structure is the root cause of the session-58 silent-stale-bundle failure and the session-60 cache isolation failure. Maintenance matters.
