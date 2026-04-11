---
name: stride-build-instructions
description: "Build rules for Stride WMS repo. Enforces SALA preflight, billing parity, tenant isolation, NVPC scope locking, and forbidden patterns. Use on every Stride build task."
---

> ⚠️ WARNING: THIS FILE IS FOR THE STRIDE WMS WEB APP (React/Supabase/SALA/RLS).
> IT DOES NOT APPLY TO THE GS INVENTORY APP (Google Sheets / Apps Script).
> DO NOT follow these instructions when working on the GS Inventory project.
> See root CLAUDE.md for GS Inventory build rules.

# Stride Build Instructions

## Prerequisite Reads (Before Any Implementation)

1. **`STRIDE_DOMAIN_KNOWLEDGE.md`** — read before implementing any feature
2. **`docs/systems/<relevant>/SYSTEM_MASTER.md`** — SALA preflight is mandatory

---

## Repository & File Storage Map

### Directory Structure

```
Apps/GS Inventory/
├── stride-gs-app/                  ← React app (Vite + TypeScript)
│   ├── src/
│   │   ├── pages/                  ← Route-level page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Receiving.tsx
│   │   │   ├── Inventory.tsx
│   │   │   ├── Billing.tsx
│   │   │   ├── Payments.tsx
│   │   │   ├── Settings.tsx
│   │   │   ├── Tasks.tsx
│   │   │   ├── WillCalls.tsx
│   │   │   ├── Claims.tsx
│   │   │   ├── Repairs.tsx
│   │   │   ├── Login.tsx
│   │   │   └── AccessDenied.tsx
│   │   ├── components/shared/      ← Reusable UI components (~23 files)
│   │   │   ├── DataTable.tsx
│   │   │   ├── ShipmentDetailPanel.tsx
│   │   │   ├── LocationPicker.tsx
│   │   │   ├── AutocompleteInput.tsx
│   │   │   ├── WriteButton.tsx
│   │   │   ├── BatchGuard.tsx
│   │   │   ├── PreChargeValidationModal.tsx
│   │   │   ├── PaymentDetailPanel.tsx
│   │   │   ├── CustomerVerificationPanel.tsx
│   │   │   └── ... (other panels/modals)
│   │   ├── hooks/                  ← Data hooks (API + state, ~16 files)
│   │   │   ├── useApiData.ts       ← Generic fetch wrapper
│   │   │   ├── useClients.ts
│   │   │   ├── usePricing.ts
│   │   │   ├── useLocations.ts
│   │   │   ├── useInventory.ts
│   │   │   └── ... (always check /src/hooks/ before creating new hooks)
│   │   ├── lib/                    ← Utilities & config
│   │   │   ├── api.ts              ← Fetch wrapper for Apps Script API
│   │   │   ├── constants.ts
│   │   │   ├── types.ts
│   │   │   └── supabase.ts
│   │   ├── data/
│   │   │   └── mockData.ts         ← Mock data for UI shell testing
│   │   ├── styles/
│   │   │   └── theme.ts            ← Design tokens (colors, typography)
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx
│   │   ├── App.tsx                 ← Router + layout
│   │   └── main.tsx                ← Entry point
│   ├── dist/                       ← Built output (deployed to GitHub Pages)
│   │   ├── CNAME                   ← mystridehub.com
│   │   ├── index.html
│   │   └── assets/                 ← JS/CSS bundles
│   ├── public/                     ← Static assets (copied to dist)
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── package.json
│   ├── vite.config.ts              ← base: '/', cacheDir in temp
│   ├── tsconfig.json
│   └── index.html                  ← Vite entry HTML
│
├── AppScripts/                     ← Google Apps Script source files
│   ├── stride-api/
│   │   └── StrideAPI.gs            ← Centralized API (deployed as "Anyone")
│   ├── Consolidated Billing Sheet/
│   │   ├── Code.gs.js
│   │   ├── Client_Onboarding.js
│   │   ├── Invoice Commit.js
│   │   ├── QB_Export.js
│   │   └── ... (other CB scripts)
│   ├── stride-client-inventory/    ← Client sheet scripts
│   ├── stax-auto-pay/              ← Payment automation
│   └── QR Scanner/                 ← Barcode/QR scanning
│
├── Doc Templates/                  ← Document templates
├── Docs/                           ← Project documentation
├── EMAIL TEMPLATES/                ← Email templates
└── INSTRUCTION GUIDES/             ← User guides
```

### File Naming Conventions

| Type | Convention | Examples |
|------|-----------|----------|
| Pages | PascalCase | `Receiving.tsx`, `Billing.tsx` |
| Shared components | PascalCase | `LocationPicker.tsx`, `WriteButton.tsx` |
| Hooks | camelCase with `use` prefix | `useClients.ts`, `usePricing.ts` |
| Lib/utils | camelCase | `api.ts`, `constants.ts`, `types.ts` |
| Styles | camelCase | `theme.ts` |
| Mock data | camelCase | `mockData.ts` |
| Apps Script | PascalCase or descriptive | `StrideAPI.gs`, `Code.gs.js` |

### Key Config Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite build config. `base: '/'` for custom domain. Cache in temp to avoid Dropbox sync issues |
| `package.json` | Dependencies. `npm run build` = `tsc -b && vite build` |
| `tsconfig.json` | TypeScript config |
| `dist/CNAME` | GitHub Pages custom domain: `mystridehub.com` |

---

## Deployment Procedures

### Local Development

```bash
# First-time setup
cd "Apps/GS Inventory/stride-gs-app"
npm install

# Start dev server (hot reload)
npm run dev
# Opens at http://localhost:5173
```

### React App Deployment (GitHub Pages)

**Repository:** `stride-dotcom/stride-dotcom.github.io` on GitHub
**Live URL:** `https://www.mystridehub.com`
**How it works:** The `dist/` folder has its own `.git` pointing to the GitHub Pages repo. Pushing `dist/` to `main` auto-deploys via GitHub Pages.

#### Builder Steps (build the app)

```bash
# 1. Navigate to the app directory
cd "Apps/GS Inventory/stride-gs-app"

# 2. Build the app (compiles TypeScript, then bundles with Vite)
npm run build

# 3. Verify the build output exists
ls dist/
# Should see: index.html, assets/, CNAME, favicon.svg, icons.svg, stride-logo.png

# 4. Verify CNAME survived the build (Vite clears dist/ before building)
# If CNAME is missing, recreate it:
echo "mystridehub.com" > dist/CNAME
```

**Note:** The `public/` folder contents (favicon.svg, icons.svg) are automatically copied to `dist/` by Vite. The CNAME file should also be in `public/` to survive rebuilds. If it's not there yet, add it: `echo "mystridehub.com" > public/CNAME`

#### User Steps (deploy to GitHub Pages)

After the builder confirms build is complete:

```bash
# 1. Open terminal / command prompt
# 2. Navigate to the dist folder
cd "Apps/GS Inventory/stride-gs-app/dist"

# 3. Stage all files
git add -A

# 4. Commit with a description of what changed
git commit -m "Deploy: <brief description of changes>"

# 5. Push to GitHub Pages (force push because dist is rebuilt each time)
git push origin main --force

# 6. Wait 1-2 minutes, then verify at https://www.mystridehub.com
```

**Important notes:**
- The `dist/` folder has its own `.git` — it is a separate repo from the source code
- `CNAME` file must stay in `dist/` — it tells GitHub Pages to serve on `mystridehub.com`
- Force push is expected here since `dist/` is rebuilt from scratch each time
- If CNAME gets deleted during build, re-create it: `echo "mystridehub.com" > dist/CNAME`

### Apps Script Deployment

Apps Script files live in `AppScripts/` as local reference copies. The actual deployment is done inside the Google Apps Script editor.

#### Updating an Apps Script Project

**Two types of Apps Script projects:**

| Type | Example | How to open |
|------|---------|-------------|
| **Standalone** (API) | Stride API (`stride-api/StrideAPI.gs`) | Open directly from script.google.com |
| **Bound** (sheet scripts) | CB Scripts (`Consolidated Billing Sheet/*.js`) | Open the sheet → Extensions → Apps Script |

**Deployment steps:**

1. Open the Apps Script project in the browser (see table above)
2. Copy the updated code from the local file into the corresponding script file in the editor
3. Click **Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy**

**Critical auth settings for the Stride API (standalone) project:**
- Execute as: **Me**
- Who has access: **Anyone** (NOT "Anyone with a Google account" — that causes CORS failures)
- The deployment URL stays the same when you update an existing deployment

**Bound scripts (CB, client sheets, stax-auto-pay):** These do NOT need web app deployment settings. They run within the spreadsheet context and are triggered by menu items, triggers, or other scripts.

#### Apps Script Config

| Setting | Location | Notes |
|---------|----------|-------|
| API_TOKEN | Script Properties (`Project Settings → Script Properties`) | Shared secret for API auth |
| CB_SHEET_ID | Hardcoded in StrideAPI.gs | Consolidated Billing spreadsheet ID |
| MASTER_PRICE_ID | Hardcoded in StrideAPI.gs | Master Price List spreadsheet ID |

### Rollback Procedures

**React app (GitHub Pages):**
```bash
cd "Apps/GS Inventory/stride-gs-app/dist"
git log --oneline -5          # find the last good commit hash
git revert HEAD               # or: git reset --hard <good-hash> && git push origin main --force
```

**Apps Script:**
- Open the project → Deploy → Manage deployments → Edit → select a previous version number → Deploy

### Dropbox Sync Safety

Builders must follow these rules to avoid file corruption from Dropbox FUSE sync:

1. **Write files outside Dropbox first** — create/edit in a temp directory, then copy the completed file into the Dropbox-synced folder
2. **Never write large files incrementally** inside the Dropbox folder — partial writes can sync mid-edit and corrupt the file
3. **Verify file integrity** after copying — read the file back to confirm it wasn't truncated
4. **.tmp files** — if you see `.tmp` files in the source tree (e.g., `Settings.tsx.tmp.5.xxxxx`), these are Dropbox sync artifacts and should be ignored/cleaned up

---

## Architecture Invariants (Never Violate)

### 1. Tenant Isolation
Every DB query MUST include `.eq("tenant_id", profile?.tenant_id)` or be covered by RLS.

- ✅ Use `app_metadata.tenant_id` — server-controlled, cannot be spoofed
- ❌ Never use `user_metadata.tenant_id` — client-writable, security vulnerability
- ❌ Never use service-role key in frontend code
- **Failure mode:** Cross-tenant data access = critical security breach

### 2. Billing Parity
Any change touching billing must produce **identical output** to the previous version.

- Billing Gateway is the single source of truth — never calculate billing inline in components
- Legacy `service_events` and new `charge_types + pricing_rules` must stay in sync
- **When in doubt: DO NOT change billing — flag for review**
- Reference: `docs/systems/billing/SYSTEM_MASTER.md`

### 3. RLS Policy Safety
Test all RLS changes against:
- ✅ Correct tenant accesses their own data
- ✅ Cross-tenant access is blocked
- ✅ Unauthenticated access is blocked

Misconfigured RLS silently returns empty results — always verify with data present. Never DROP and recreate RLS policies without explicit instruction.

### 4. Migration Safety
- **Allowed without approval:** ADD columns, ADD indexes, ADD policies
- **Requires explicit approval:** DROP column, DROP table, DROP policy
- New columns must have DEFAULT or be nullable — never break existing rows
- New RPC functions require grants for `anon` + `authenticated` roles

### 5. API Architecture (Apps Script)
- **Token auth:** Token stored in Script Properties, sent via `?token=xxx` query param
- **Standard fetch:** Use `fetch()` with `redirect: 'follow'` — no JSONP, no proxy
- **Deploy as "Anyone":** NOT "Anyone with a Google account" (causes CORS failures)
- **JSON responses:** `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)`
- **Client isolation:** GET /clients must omit internal fields (sheetId, folderId) for client portal users
- **Read-only first:** All endpoints start read-only; write endpoints require separate approval

---

## SALA System Map

| Feature Area | SYSTEM_MASTER Path |
|-------------|-------------------|
| Receiving & dock intake | `docs/systems/receiving-dock-intake/` |
| Inventory | `docs/systems/inventory/` |
| Putaway & locations | `docs/systems/capacity-heatmap/` |
| Shipments | `docs/systems/shipments/` |
| Tasks & work queues | `docs/systems/tasks/` |
| Billing & invoicing | `docs/systems/billing/` |
| Client portal | `docs/systems/client-portal/` |
| Claims | `docs/systems/claims/` |
| Alerts | `docs/systems/alerts/` |
| Security & RLS | `docs/systems/security/` |
| Quotes | `docs/systems/quotes/` |
| Routing | `docs/systems/routing/` |
| Auth & roles | `docs/systems/auth-roles-tenant/` |
| Storage & media | `docs/systems/storage-media/` |
| Stocktake | `docs/systems/stocktake/` |
| Settings & pricing | `docs/systems/settings-pricing-service-codes/` |
| Super admin | `docs/systems/super-admin-audit/` |
| Comms & webhooks | `docs/systems/communications-notifications-webhooks/` |
| Scan hub | `docs/systems/scanhub/` |
| Warehouse map | `docs/systems/warehouse-map/` |

**Risk triggers — MUST read extra source if change touches:**
- Security / RLS / auth → `docs/systems/security/SYSTEM_MASTER.md`
- Storage / uploads → `docs/systems/storage-media/SYSTEM_MASTER.md`
- Billing / Stripe / rates → `docs/systems/billing/SYSTEM_MASTER.md`

---

## Code Patterns

### Supabase Query (tenant-scoped)
```typescript
const { data, error } = await supabase
  .from("table_name")
  .select("*")
  .eq("tenant_id", profile?.tenant_id)
  .order("created_at", { ascending: false });
```

### React Query Hook Structure
```typescript
export function useFeatureName() {
  const { profile } = useAuth();

  const query = useQuery({
    queryKey: ["feature_name", profile?.tenant_id],
    queryFn: async () => { /* supabase call */ },
    enabled: !!profile?.tenant_id,
  });

  const mutation = useMutation({
    mutationFn: async (data) => { /* supabase call */ },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature_name"] });
      toast({ title: "Success message" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return { ...query, create: mutation.mutate };
}
```

### Component Rules
- Always use shadcn components from `@/components/ui/`
- Toast via `useToast` for all async feedback
- Forms via React Hook Form + Zod schema
- Error boundaries must wrap feature components

### Naming Conventions
- Components: `PascalCase` — e.g. `BillingReportTab.tsx`
- Hooks: `camelCase` with `use` prefix — e.g. `useInvoices.ts`
- Pages: `PascalCase` — e.g. `Invoices.tsx`

---

## Pre-Implementation Checklist

Before writing any code:
- [ ] Check `/src/hooks/` — don't create duplicate hooks
- [ ] Check `/src/components/` — don't create duplicate components
- [ ] Read and cite relevant SYSTEM_MASTER.md
- [ ] Define SCOPE LOCK — list exact files allowed to change
- [ ] Billing implications? → read billing SYSTEM_MASTER first
- [ ] RLS implications? → read security SYSTEM_MASTER first

---

## Feature Readiness Checklist

Before shipping to production:
- [ ] RLS covers SELECT, INSERT, UPDATE, DELETE as appropriate
- [ ] All lists paginated — no unbounded queries
- [ ] DB indexes verified with EXPLAIN ANALYZE
- [ ] React Query cache invalidated after mutations
- [ ] Error boundary wraps the feature
- [ ] Toast feedback on all async actions
- [ ] Mobile layout tested
- [ ] Billing event captured if feature is billable
- [ ] Audit log entry for sensitive data changes

---

## Forbidden Patterns

| Never Do | Reason |
|----------|--------|
| Infer billing logic without reading billing SYSTEM_MASTER | Causes revenue loss |
| Create hooks/components without checking for existing ones | Duplication and inconsistency |
| Add columns without null/default safety | Breaks existing rows in production |
| Skip SALA preflight | Drift causes production incidents |
| Use `user_metadata` for tenant_id | Client-writable — security hole |
| Make billing changes without parity verification | Risks revenue disruption |
| Expand scope beyond SCOPE LOCK | #1 cause of unexpected breakage |
| Calculate billing amounts in React components | Belongs in Billing Gateway only |
| Write files incrementally inside Dropbox folder | Causes file truncation/corruption |
| Deploy Apps Script as "Anyone with Google account" | Causes CORS failures from app domain |

---

## NVPC Stop Conditions (HALT immediately)

- Cannot locate relevant SYSTEM_MASTER → STOP, report missing source
- Risk trigger present but extra source missing → STOP
- Scope unclear or undefined → STOP, request clarification
- Change would affect billing output → STOP, flag for review
- Change requires dropping RLS policy → STOP, get explicit approval

---

## Response Contract (Every Build Response)

**Must begin with:**
- `SALA SOURCES USED` — exact file paths
- `EXTRA SOURCES USED` — if risk triggers apply
- `SCOPE LOCK` — exact files and functions allowed to change

**Must end with:**
```
COMPLETE EXECUTION SUMMARY
```
One fenced code block. Copy/paste ready. Not truncated. Missing any section = non-compliant.
