# Stride GS App

React frontend for the Stride Logistics GS Inventory system — a 3PL warehouse,
billing, and delivery management app for Stride's Kent, WA operation.

**Live:** https://www.mystridehub.com

## What this is

Per-client Google Sheet inventories (one sheet per tenant) are wrapped by a
Google Apps Script Web App (`StrideAPI.gs`) that this React app calls. Supabase
mirrors all entities as a read cache, handles auth, and runs the DispatchTrack
delivery integration plus messaging and audit-log infrastructure. Billing logic
stays server-side in Apps Script; React never calculates it.

```
Master Price List     →  pricing, class map, templates (Supabase-authoritative)
Consolidated Billing  →  storage charges, invoicing, QuickBooks export
Client Inventory (×N) →  per-client sheet (Inventory, Tasks, Repairs, Will Calls, Billing_Ledger)
StrideAPI.gs          →  Apps Script Web App backing the React app
React app             →  GitHub Pages, reads StrideAPI + Supabase cache
Supabase              →  read cache + DT delivery + messaging + audit log + auth
```

GAS writes are the execution authority. Supabase is a read cache that mirrors
GAS writes and powers realtime UI updates (~1–2s end-to-end).

## Tech stack

- Vite 8 + React 19 + TypeScript 5.9
- TanStack Table v8 (data grids), TanStack Virtual v3 (virtualized rows)
- React Router v7 with HashRouter (GitHub Pages SPA compatibility)
- Supabase JS client (read cache, realtime, auth)
- Lucide React icons
- jsPDF + xlsx for client-side report/export generation
- html5-qrcode for the warehouse barcode scanner

## Repo layout

```
.
├── stride-gs-app/   ← THIS DIRECTORY: React app (Vite + TypeScript)
├── AppScripts/      ← Google Apps Script backend + rollout tooling
├── _archive/        ← Design specs, session history, decision log
└── CLAUDE.md        ← Canonical builder guide
```

## Development

Full setup, branching rules, deploy commands, and gotchas live in
[`../CLAUDE.md`](../CLAUDE.md). Read that first.

Quick start for a fresh clone:

```bash
git clone https://github.com/Stride-dotcom/Stride-GS-app.git C:\dev\Stride-GS-app
cd C:\dev\Stride-GS-app\stride-gs-app
npm install
# Copy .env from the credentials Dropbox into stride-gs-app/.env
npm run dev
```

## Build / deploy

| Command | Result |
|---|---|
| `npm run dev` | Local dev server (Vite HMR) |
| `npm run build` | Production build via guarded script (verify-entry → tsc → vite → sanity checks) |
| `npm run build:raw` | Skip safeguards (emergency only) |
| `npm run deploy -- "what changed"` | Build → push `dist/` → commit source |
| `npm run lint` | ESLint over the project |

Deploys MUST run from the canonical clone at `C:\dev\Stride-GS-app\stride-gs-app\`,
never from a worktree. See [`../CLAUDE.md`](../CLAUDE.md) for the full deploy
reference, the worktree workflow for parallel builders, and the billing-system
guardrails that any contributor must read before touching billing code.
