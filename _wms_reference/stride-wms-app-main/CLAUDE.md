# CLAUDE.md — AI Assistant Guide for Stride WMS

## Project Overview

**Stride WMS** is an enterprise-grade Warehouse Management System for 3PL providers. It handles inventory tracking, shipment processing, claims management, billing/invoicing, cycle counts, repair quotes, and client self-service.

It is a single-product React + TypeScript + Vite SPA backed by a hosted Supabase project. There is no local backend — auth, database, storage, and edge functions all run on the remote Supabase instance configured in `.env`.

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: shadcn-ui + Radix UI + Tailwind CSS
- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (JWT-based)
- **State**: TanStack React Query v5
- **Forms**: React Hook Form + Zod
- **Mobile**: Capacitor 8 (iOS/Android)
- **PDF**: jsPDF
- **Excel**: xlsx library

## Lint / Test / Build

| Task | Command | Notes |
|------|---------|-------|
| Dev server | `npm run dev` | Vite on port **8080** (IPv6 `::` host, accessible via `localhost:8080`) |
| Lint | `npm run lint` | ESLint 9 flat config. Pre-existing `no-explicit-any` errors are known; do not attempt to fix them. |
| Unit tests | `npm run test` | Vitest — currently a single example test. |
| E2E tests | `npm run test:e2e` | Playwright (Chromium). Install browsers first with `npm run test:e2e:install`. |
| Build | `npm run build` | Production Vite build into `dist/`. |

## Gotchas

- ESLint does not suppress `@typescript-eslint/no-explicit-any`, so `npm run lint` exits non-zero on the existing codebase. Check for *new* lint errors only.
- Playwright E2E tests require Chromium: `npx playwright install --with-deps chromium`.
- Supabase edge functions (under `supabase/functions/`) run in the Deno runtime on the hosted project — they are not executed locally.
- The `.env` file includes `VITE_ENABLE_DEV_QUICK_LOGIN="true"`, which adds role-based quick-login buttons on the auth page.

## Key Coding Patterns

### Hooks
Data fetching uses custom hooks in `/src/hooks/`. Each hook provides fetch, create, update, delete functions plus loading states.

### Component Organization
- Pages in `/src/pages/` handle routing/layout
- Feature components are domain-organized under `/src/components/`
- Shared UI primitives in `/src/components/ui/` (shadcn)

### Database Access
All database access goes through the Supabase client with tenant_id scoping:
```typescript
import { supabase } from "@/integrations/supabase/client";
const { data, error } = await supabase
  .from("table_name")
  .select("*")
  .eq("tenant_id", profile?.tenant_id);
```

### Naming Conventions
- Components: PascalCase (`BillingReportTab.tsx`)
- Hooks: camelCase with `use` prefix (`useInvoices.ts`)
- Pages: PascalCase (`Invoices.tsx`)

---

## === STRIDE SALA PREFLIGHT (MANDATORY) ===

You MUST complete the following BEFORE any plan, analysis, or code:

────────────────────────────────────────
### STEP 1 — MAP THE CHANGE TO SYSTEMS
────────────────────────────────────────
- In 1–3 bullets, restate what is being changed.
- List the affected system(s) by matching them to SALA SYSTEM_MASTER docs under:
  `/docs/systems/**/SYSTEM_MASTER.md`

────────────────────────────────────────
### STEP 2 — READ + CITE SALA SOURCES
────────────────────────────────────────
- Locate and read the relevant SYSTEM_MASTER.md file(s).
- Output a section titled:
  **SALA SOURCES USED**
  - `<exact file path(s)>`

**HARD STOP CONDITION:**
If you cannot locate a relevant SYSTEM_MASTER document:
→ STOP immediately.
→ Respond with: "Missing authoritative SALA source for this change."
→ Do NOT infer behavior.
→ Do NOT proceed with implementation.

────────────────────────────────────────
### STEP 3 — RISK-TRIGGER CHECK
────────────────────────────────────────
If the change touches ANY of the following, you MUST also read and cite additional sources:

A) Security / RLS / auth / roles / tenant or account isolation
B) Storage buckets / signed URLs / uploads / retention
C) Billing events / invoices / credits / rates / defaults / Stripe / webhooks

If triggered, output:
**EXTRA SOURCES USED**
- `/docs/systems/security/SYSTEM_MASTER.md` (if present)
- `/docs/systems/storage-media/SYSTEM_MASTER.md` (if present)
- `/docs/systems/billing/SYSTEM_MASTER.md` (if relevant)
- `/docs/architecture/ARCH_RISK_REGISTER.md` (if present)

If an EXTRA SOURCE is required but missing:
→ STOP and report the missing document.
→ Do NOT proceed.

────────────────────────────────────────
### STEP 4 — SCOPE LOCK
────────────────────────────────────────
- List exact files and functions allowed to change.
- If scope is missing or unclear:
  → STOP and request clarification.

No silent file expansion permitted.

────────────────────────────────────────
### STEP 5 — EVIDENCE STANDARD
────────────────────────────────────────
- No speculation.
- Every non-trivial behavioral claim must include:
  `[Evidence: <path>:Lx-Ly | <symbol>]`
  OR exact search proof snippet.

────────────────────────────────────────
### RESPONSE CONTRACT (NON-NEGOTIABLE)
────────────────────────────────────────
Every build response MUST:

1) Begin with:
   - **SALA SOURCES USED**
   - **EXTRA SOURCES USED** (if any)
   - **SCOPE LOCK**

2) End with:
   **COMPLETE EXECUTION SUMMARY**
   in ONE single fenced code block
   - Copy/paste ready
   - Not truncated
   - Final content in response

If any required section is missing, the build is non-compliant.

### === END PREFLIGHT ===

## Available SYSTEM_MASTER Documents

- `docs/systems/alerts/SYSTEM_MASTER.md`
- `docs/systems/billing/SYSTEM_MASTER.md`
- `docs/systems/capacity-heatmap/SYSTEM_MASTER.md`
- `docs/systems/claims/SYSTEM_MASTER.md`
- `docs/systems/client-portal/SYSTEM_MASTER.md`
- `docs/systems/inventory/SYSTEM_MASTER.md`
- `docs/systems/quotes/SYSTEM_MASTER.md`
- `docs/systems/receiving-dock-intake/SYSTEM_MASTER.md`
- `docs/systems/routing/SYSTEM_MASTER.md`
- `docs/systems/security/SYSTEM_MASTER.md`
- `docs/systems/shipments/SYSTEM_MASTER.md`
- `docs/systems/tasks/SYSTEM_MASTER.md`

Additional reference: `docs/systems/SALA_TEMPLATE_v1.2.md` (canonical template), `docs/ledger/sources/SOURCE_REGISTRY.md` (decision ledger registry).
