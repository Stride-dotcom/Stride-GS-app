# Payments Page Redesign — Workflow Plan

> **Status:** DRAFT — for Justin's review before implementation
> **Date:** 2026-04-05
> **Purpose:** Restructure the Payments page to match the actual billing → payment workflow, add invoice editing, and make the auto-charge queue visible.

---

## Current Pain Points (from Justin's feedback)

1. Tab order doesn't match the workflow — IIF Import is tab 5 of 8 but it's the first step
2. Invoices are read-only — no way to edit due date, amount, or customer before pushing to Stax
3. "Run Charges" button at the top is confusing — looks like the first action but actually requires CREATED invoices
4. No visibility into what's queued for future auto-charge (which invoices will be charged on which dates)
5. No way to select which invoices to charge — it's all-or-nothing
6. Pre-Charge Validation modal was showing mock data (fixed in a previous build)

---

## Proposed Workflow (5 steps, left to right)

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐
│ 1. Import │ →  │ 2. Review &  │ →  │ 3. Push to   │ →  │ 4. Queue │ →  │ 5. Charge│
│    IIF    │    │    Edit      │    │    Stax      │    │  Status  │    │   Log    │
└──────────┘    └──────────────┘    └──────────────┘    └──────────┘    └──────────┘
  Upload QB       Edit due dates,    Creates invoices    See what's       All charge
  billing file    amounts, review    in Stax system.     scheduled for    attempts,
  → PENDING rows  before pushing.    Status: CREATED     which dates.     results,
                  Delete bad rows.                       Auto-charge      exceptions.
                                                         runs at 9 AM.
```

---

## Proposed Tab Structure (7 tabs, reordered)

| # | Tab Name | What it shows | Primary action |
|---|----------|---------------|----------------|
| 1 | **Import** (default landing) | IIF file upload + parse preview + import history | "Import File" button |
| 2 | **Review** | PENDING invoices only — editable fields | "Push to Stax" button (creates Stax invoices) |
| 3 | **Invoices** | All invoices (all statuses) — the full list | Status filter chips, void button, sort |
| 4 | **Charge Queue** | CREATED invoices grouped by due date — what's coming up | "Run Charges Now" button (manual override) |
| 5 | **Charge Log** | All charge attempts and results | (read-only) |
| 6 | **Exceptions** | Failed charges needing attention | Resolve / Send Pay Link buttons |
| 7 | **Customers** | Stax customer mapping | Sync / Auto-Match buttons |

**Removed tabs:** "IIF → Stax" (merged into Review), "Customer Map" (merged into Customers), "Run Log" (merged into Charge Log as a sub-section or filter).

---

## Tab 1: Import (Landing Tab)

### What it looks like
Same as current IIF Import tab, but as the first thing you see.

### Workflow
1. Admin uploads a `.iif` file from QuickBooks
2. System parses it and shows a preview table (invoice #, customer, amount, due date)
3. Admin clicks "Import" → rows are written to the Stax spreadsheet Invoices tab as PENDING
4. Success message: "12 invoices imported — go to Review tab to edit and push to Stax"
5. Badge on Review tab updates with PENDING count

### Changes from current
- Moves from tab 5 → tab 1
- After successful import, auto-switches to Review tab
- No other changes to import logic

---

## Tab 2: Review (NEW — replaces part of current Invoices tab)

### What it shows
Only PENDING invoices (not yet pushed to Stax). This is the "staging area" before you commit.

### Editable fields on each row (PENDING only)

| Field | Editable? | How | Notes |
|---|---|---|---|
| QB Invoice # | Read-only | — | Set at import time, can't change |
| Customer | Editable | Dropdown (from Stax customers list) | Fix customer mapping issues before pushing |
| Amount | Editable | Number input | Adjust if QB amount was wrong |
| Due Date | Editable | Date picker | Set when you want auto-charge to run |
| Status | Read-only | — | Always PENDING on this tab |
| Notes | Editable | Text input | Admin notes |

### Edit UX
Click a cell to edit inline (same pattern as the Billing page editable cells). Changes write directly to the Stax spreadsheet Invoices tab via a new `updateStaxInvoice` endpoint.

### Actions
- **"Push to Stax"** button at top: Creates Stax invoices for all PENDING rows (same as current "Create Stax Invoices"). After success, invoices move to CREATED status and disappear from this tab (they're now visible on the Invoices tab and Charge Queue tab).
- **"Delete"** button per row: Removes the row entirely (not void — just delete from sheet). For cleaning up bad imports before pushing to Stax.
- **"Select All / Select None"** checkboxes: Choose which PENDING invoices to push (instead of all-or-nothing). Only selected rows get pushed to Stax.

### Questions for Justin
- **Q1:** Should "Push to Stax" push ALL pending rows, or only selected rows? (Currently it's all-or-nothing.)
- **Q2:** Should deleted PENDING rows be permanently removed from the sheet, or just marked as DELETED?
- **Q3:** Do you want to be able to edit the customer name (text) or select from the Stax customer dropdown?

---

## Tab 3: Invoices (Current — with improvements already built)

### What it shows
All invoices across all statuses. Same as current Invoices tab with the improvements already deployed:
- Status filter chips (PENDING, CREATED, PAID, CHARGE_FAILED, VOIDED)
- Sortable column headers
- Void button on non-PAID rows
- Test invoice badge
- Charge / Test / Run Now buttons on CREATED rows

### Changes from current
- Moves from tab 1 → tab 3 (no longer the landing tab)
- No editing here — editing happens on the Review tab for PENDING invoices only
- PENDING rows show a subtle "Go to Review tab to edit" hint instead of action buttons

---

## Tab 4: Charge Queue (NEW)

### What it shows
Only CREATED invoices (pushed to Stax, waiting for their due date). Grouped by due date.

### Layout
```
┌─ Due Today (3 invoices — $1,245.00) ──────────────────────────────┐
│  INV-089  Pacific NW Staging    $115.00   due 04/05  ✅ Ready     │
│  INV-090  Thompson Interiors    $248.00   due 04/05  ✅ Ready     │
│  TEST-001 Justin Demo Account    $1.00    due 04/05  🧪 Test     │
├─ Due Tomorrow (1 invoice — $95.00) ───────────────────────────────┤
│  INV-091  Allison Lind Design    $95.00   due 04/06  ✅ Ready     │
├─ Due This Week (2 invoices — $380.00) ────────────────────────────┤
│  INV-092  New Client Co.        $180.00   due 04/08  ⚠️ No PM    │
│  INV-093  Pacific NW Staging    $200.00   due 04/10  ✅ Ready     │
├─ Due Later (1 invoice — $500.00) ─────────────────────────────────┤
│  INV-094  Thompson Interiors    $500.00   due 04/25  ✅ Ready     │
└───────────────────────────────────────────────────────────────────┘
```

### Status indicators
- ✅ **Ready** — has Stax Customer ID + payment method on file
- ⚠️ **No Payment Method** — customer exists in Stax but no card/ACH on file
- ❌ **No Customer** — customer not mapped to Stax

### Actions
- **"Run Charges Now"** button: charges all "Due Today" invoices immediately (same as current). Shows Pre-Charge Validation modal first.
- **"Run Charges (Dry Run)"** when Dry Run toggle is on
- Individual "Charge Now" button per row (skips due date check, charges that one invoice immediately)

### Why this tab matters
Right now, there's no way to see "what's going to be charged tomorrow" or "which invoices are waiting for next week." This tab makes the auto-charge queue visible and predictable. When the daily trigger runs at 9 AM, it charges everything in the "Due Today" group. You can see exactly what's coming.

### Questions for Justin
- **Q4:** Should the Charge Queue show "readiness" status (payment method check)? This requires calling the Stax API for each customer to verify they have a payment method on file — could be slow with many customers.
- **Q5:** Do you want to be able to change the due date from this tab (after push to Stax but before charge)?

---

## Tab 5: Charge Log (Current — minor improvements)

### What it shows
All charge attempts — successful, failed, dry-run, partial. Same as current Charge Log tab.

### Changes from current
- Dry-run entries show amber `[DRY RUN]` badge (already built)
- Add status filter chips: SUCCESS, DECLINED, API_ERROR, DRY_RUN_PASSED, PARTIAL
- Consider merging Run Log entries here as a "System Events" sub-filter (instead of separate tab)

---

## Tab 6: Exceptions (Current — no changes)

Same as today. Failed charges with Resolve and Send Pay Link buttons.

---

## Tab 7: Customers (Current — merged)

Merge current "Customers" tab and "Customer Map" tab into one:
- Top section: Stax customer list with Sync / Pull buttons
- Bottom section: QB ↔ Stax customer mapping table with Auto-Match and manual edit

---

## Summary Card Row (top of page — current + changes)

| Card | Current | Proposed |
|---|---|---|
| Pending Invoices | Count of PENDING | Rename to **"Awaiting Review"** — count of PENDING |
| Collected (30d) | Sum of recent successful charges | Keep as-is |
| Open Exceptions | Count of unresolved exceptions | Keep as-is |
| Auto-Charge | ON/OFF toggle | Keep as-is |
| *(NEW)* Queued for Payment | — | Count of CREATED invoices with due date ≤ 7 days |

---

## Backend Changes Needed

| Endpoint | Change |
|---|---|
| `updateStaxInvoice` (NEW) | Admin-only. Accepts `{ qbInvoiceNo, dueDate?, amount?, customer?, notes? }`. Only works on PENDING status rows. Validates amount > 0, date format. |
| `deleteStaxInvoice` (NEW) | Admin-only. Permanently removes a PENDING row from the Invoices sheet. Refuses non-PENDING rows. |
| `createStaxInvoices` | Add optional `invoiceNos` array param — push only selected PENDING invoices instead of all. If omitted, pushes all (backward compatible). |
| `handleGetStaxInvoices_` | Already returns all needed fields including `isTest`. No changes needed. |

---

## Build Phases

### Phase 1 — Tab reorder + Review tab (1-2 hours)
- Reorder tabs: Import → Review → Invoices → Charge Queue → Charge Log → Exceptions → Customers
- Build Review tab: PENDING invoices only, inline editing (due date, amount, customer, notes), delete button, selective "Push to Stax"
- Backend: `updateStaxInvoice` + `deleteStaxInvoice` endpoints
- Default landing = Import tab

### Phase 2 — Charge Queue tab (1 hour)
- Group CREATED invoices by due date (Today, Tomorrow, This Week, Later)
- Readiness indicators (payment method check — may need to be lazy-loaded)
- Individual "Charge Now" button per row

### Phase 3 — Polish (30 min)
- Merge Customer Map into Customers tab
- Merge Run Log into Charge Log
- Update summary cards
- Tab badges (PENDING count on Review, "due today" count on Queue)

---

## Answered Questions (2026-04-05)

1. **Q1:** Select All + multi-select checkboxes. Push only selected rows.
2. **Q2:** Mark as DELETED/VOIDED (not permanent remove) — in case we need to revert and re-run.
3. **Q3:** Dropdown from Stax customer list.
4. **Q4:** Yes — show payment method readiness on Charge Queue.
5. **Q5:** Yes — due date editable after push. The app-side due date controls when auto-charge processes it.
6. **Q6:** No Stax catalog setup needed — API sends lump-sum total with line items as metadata. Stax catalog is only for their built-in invoicing UI, not API-created invoices.
7. **Q7:** Select All + multi-select checkboxes.

---

## What Does NOT Change

- The actual Stax API integration (invoice creation, charging, pay links)
- The daily auto-charge trigger at 9 AM Pacific (StaxAutoPay.gs)
- The IIF file parsing logic
- The Stax customer sync/pull logic
- The exception handling flow
- Test invoice creation + Dry Run mode (already built)
