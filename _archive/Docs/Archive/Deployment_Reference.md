# Deployment Reference (Archived Full Guide)

> Full deployment reference for the GS Inventory Google Sheets system. The main `CLAUDE.md` carries only a condensed deploy table; this archive has every corner case, auth prereq, and troubleshooting note.

---

## Core rule: Web App deployments are frozen snapshots

`npm run rollout` and `npm run push-api` push **source code** to the Apps Script project, but the **live Web App endpoint** keeps serving whatever snapshot was frozen at its last deployment. **Pushing source ≠ deploying.**

Symptom of forgetting this: remote admin commands and React API calls return `ok: true` but behave as if the new code never ran. Headers don't get added, new payload fields get ignored, endpoints claim success while silently no-op'ing. You'll chase ghost bugs for hours.

**Rule:** After ANY push that touches code invoked by a Web App endpoint, you MUST run the matching `deploy-*` command to refresh the frozen snapshot. This includes:
- `RemoteAdmin.gs` and anything called by its wrappers (`Code.gs`, `Utils.gs`, `Tasks.gs`, etc. — yes, even leaf helpers, because the wrappers transitively call them)
- `StrideAPI.gs` — its `doGet`/`doPost` is a Web App, same rule
- `CB` scripts if the QR Scanner Web App (`doGet` in CB) calls them

**When in doubt, run `deploy-all`. It's idempotent and cheap.**

---

## Deploy commands by change type

| Change type | Push source | Refresh Web App snapshot (MANDATORY) |
|---|---|---|
| Client inventory scripts (`src/*.gs`) | `npm run rollout` | `npm run deploy-clients` |
| StrideAPI.gs | `npm run push-api` | `npm run deploy-api` |
| QR Scanner scripts | `npm run push-scanner` | `npm run deploy-cb` |
| CB scripts (if Web App touched) | `npm run push-cb` | `npm run deploy-cb` |
| Everything at once | — | `npm run deploy-all` |
| React app (`.tsx`/`.ts` files) | `npx tsc --noEmit && npm run build` then `cd dist && git add -A && git commit -m "Deploy: <summary>" && git push origin main --force` | GitHub Pages auto-refreshes (CDN may take 1–5 min; hard-refresh to verify bundle hash) |
| Email templates | `npm run push-templates` | `npm run refresh-caches` |
| Master Price List script | `npm run push-master` | (not a Web App — no deploy step) |
| Task Board script | `npm run push-taskboard` | (not a Web App — no deploy step) |
| Stax Auto Pay script | `npm run push-stax` | (not a Web App — no deploy step) |

All commands run from: `C:\Users\Justin\Dropbox\Apps\GS Inventory\AppScripts\stride-client-inventory`
React build/deploy runs from: `C:\Users\Justin\Dropbox\Apps\GS Inventory\stride-gs-app`

---

## Canonical full-deploy sequence (post-session)

```bash
# 1. Push all source changes
npm run rollout          # client inventory src/*.gs
npm run push-api         # StrideAPI.gs
npm run push-cb          # CB scripts (if changed)
npm run push-master      # Master Price List (if changed)
npm run push-taskboard   # Task Board (if changed)
npm run push-scanner     # QR Scanner (if changed)

# 2. Refresh ALL Web App deployment snapshots — DO NOT SKIP
npm run deploy-all       # clients + API in one shot
# Or individually:
# npm run deploy-clients
# npm run deploy-api
# npm run deploy-cb

# 3. Push email templates + refresh client caches (if templates changed)
npm run push-templates
npm run refresh-caches

# 4. React app build + deploy (if .tsx/.ts changed)
cd ../../stride-gs-app && npx tsc --noEmit && npm run build
cd dist && git add -A && git commit -m "Deploy: <summary>" && git push origin main --force
```

---

## Required end-of-session checklist

1. Run all applicable push commands
2. **Run the matching `deploy-*` command for every Web App-facing push — this is non-optional**
3. Confirm each command exits with success (no errors)
4. Report exact version numbers deployed (e.g. "StrideAPI.gs v38.3.0, Web App v131")
5. If a deploy fails: report the error output — do not omit it or mark the task complete

## How to spot a stale deployment bug

If a remote admin or API call returns `ok: true` but the expected side-effect is missing (new column wasn't added, new payload field ignored, new response field missing), the first thing to check is **"did I run `deploy-*` after the last `push-*`?"** 95% of the time that's the answer. Run `deploy-all` and retest before debugging code.

---

## All npm scripts reference

| Command | What it does |
|---|---|
| `npm run rollout` | Push code to ALL active clients + master template |
| `npm run rollout:dry` | Preview what would be pushed (no changes made) |
| `npm run rollout:pilot` | Push only to clients in "pilot" group |
| `npm run sync` | Rebuild clients.json from CB Clients tab |
| `npm run verify` | Check trigger health on all clients |
| `npm run health-check` | Health check all clients (required tabs, triggers, master ID) |
| `npm run update-headers` | Run Update Headers & Validations on all clients remotely |
| `npm run install-triggers` | Reinstall triggers on all clients remotely |
| `npm run refresh-caches` | Refresh Price/Class/Email caches on all clients remotely |
| `npm run remote -- --fn=FunctionName` | Run any wrapper function on all clients |
| `npm run push-api` | Push StrideAPI.gs to standalone Stride API project |
| `npm run push-cb` | Push all 11 CB scripts to Consolidated Billing project |
| `npm run push-master` | Push Master Price list script to Master Price List project |
| `npm run push-taskboard` | Push Task Board script to Task Board project |
| `npm run push-stax` | Push Stax Auto Pay script to Stax project |
| `npm run push-scanner` | Push QR Scanner scripts (5 files) to CB project (run `deploy-cb` after) |
| `npm run push-templates` | Push all 17 email templates from local `EMAIL TEMPLATES/` to Master Price List |
| `npm run deploy-clients` | Update Web App deployments on all client sheets (after rollout) |
| `npm run deploy-api` | Update Web App deployment on StrideAPI (after push-api) |
| `npm run deploy-cb` | Update Web App on CB / QR Scanner (after push-cb or push-scanner) |
| `npm run deploy-all` | Update Web App deployments on clients + StrideAPI |
| `npm run setup` | First-time OAuth2 setup (one-time per computer) |

---

## Remote admin: Web App pattern (not scripts.run)

The Apps Script Execution API (`scripts.run`) was blocked by a 403 PERMISSION_DENIED error in this Google Workspace environment despite correct scopes, GCP linkage, and API Executable deployments. Remote execution was implemented via Web App `doPost()` endpoints in `RemoteAdmin.gs` instead. Each client script is deployed as a Web App (Execute as: Me, Anyone can access) with a shared auth token. The `run-remote.mjs` tool POSTs to each client's `webAppUrl` from `clients.json`.

---

## New client onboarding checklist

After creating a new client spreadsheet via onboarding:
1. `npm run rollout` to push all scripts (including RemoteAdmin.gs) to the new client
2. Open the new client's Apps Script editor → Deploy → New deployment → Web App → Execute as: Me, Anyone → Deploy
3. Copy the Web App URL and add it to `admin/clients.json` as `"webAppUrl": "https://..."`
4. Run `npm run deploy-clients` to register the deployment for future automated updates

> **For claim email templates specifically:** `refresh-caches` is not needed. StrideAPI.gs reads templates directly from Master Price List, not from client sheet caches.

---

## Auth prerequisites

All terminal commands share the same OAuth credentials at `admin/.credentials.json`.
- If credentials are missing or expired: `npm run setup` (interactive). Setup auto-detects `admin/client_secret.json` if present.
- push-cb, push-master, push-api, and rollout all work with existing credentials as long as they're valid
- Remote admin (health-check, update-headers, etc.) uses Web App HTTP POST — no special OAuth scopes needed beyond rollout scopes
- If token needs full re-authorization with all 10 scopes: `node admin/reauth.mjs` (opens browser, paste code)
- OAuth scopes required: `script.projects`, `script.deployments`, `script.external_request`, `script.scriptapp`, `spreadsheets`, `drive`, `documents`, `gmail.send`, `gmail.settings.basic`, `userinfo.email`

---

## GCP project (StrideAPI.gs — linked 2026-04-04)

StrideAPI.gs was migrated from Apps Script default shared quota pool to a dedicated GCP project:
- **Project:** Stride GS Inventory System
- **Project number:** `1011527166052`
- **Project ID:** `stride-gs-inventory-system`
- **Enabled APIs:** Google Drive, Google Docs, Google Sheets, Apps Script
- **Rationale:** eliminates "User rate limit exceeded" warnings on `files.copy` during PDF generation; raises Drive burst ceiling ~10x

If you ever need to re-link after a project migration:
1. Open https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/settings
2. Scroll to "Google Cloud Platform (GCP) Project" → Change project
3. Paste project number `1011527166052`
4. Set project
5. Re-accept any OAuth consent prompts

---

## Deploy React app to GitHub Pages (mystridehub.com)

```bash
# Run from: C:\Users\Justin\Dropbox\Apps\GS Inventory\stride-gs-app
npm run build

# Then commit and push the dist folder:
cd dist
git add -A
git commit -m "Deploy: <description of changes>"
git push origin main --force
```

The live site updates automatically within ~1 minute after the push. CDN may take 1-5 additional minutes; hard-refresh (Ctrl+Shift+R) to verify the deployed bundle hash matches the local `dist/assets/` folder.

**Check deployed state:**
```bash
cd "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app/dist"
git log --oneline -5         # See what's deployed
git status                   # Check for uncommitted build output
```
