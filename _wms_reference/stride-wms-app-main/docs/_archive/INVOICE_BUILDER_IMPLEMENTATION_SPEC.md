# Invoice Builder Feature - Implementation Specification

## Overview

The Invoice Builder feature allows users to create invoices from billing events with flexible grouping options.

## User Flow

```
[Billing Report] ──Filter & Select──► [Create Invoice Button]
                                              │
                                              ▼
                              [Invoice Builder Tab - Revenue Ledger]
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                        [By Account]   [By Sidemark]   [Custom Grouping]
                              │               │               │
                              └───────────────┼───────────────┘
                                              ▼
                                    [Preview Invoices]
                                              │
                                              ▼
                                    [Create Invoices]
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                       [Saved Invoices]  [Email Send]   [Download PDF]
                              │
                              ▼
                   [Account Records Tab]
```

## Key Decisions

| Decision | Choice |
|----------|--------|
| Invoice numbering | Global sequential: INV-00001, INV-00002, etc. |
| Batch tracking | Yes - invoices created together get a shared batch_id |
| Due dates | From account billing_net_terms → org default_net_terms → 30 days |
| Payment tracking | Configurable per org (simple vs full with partial payments) |
| PDF storage | Generate on-demand (no persistent storage) |
| Grouping UI | Presets + Custom checkbox builder |
| Account invoices tab | View and download only |

## Database Schema

### New Columns

**invoices table:**
- `batch_id` UUID - tracks invoices created together

**tenant_preferences table:**
- `default_net_terms` INTEGER DEFAULT 30
- `invoice_payment_tracking_mode` TEXT DEFAULT 'simple' CHECK ('simple', 'full')

**invoice_lines table:**
- `charge_type` TEXT
- `occurred_at` TIMESTAMP WITH TIME ZONE
- `sidemark_name` TEXT

### Invoice Number Function

```sql
CREATE OR REPLACE FUNCTION next_global_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  invoice_num TEXT;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN invoice_number ~ '^INV-[0-9]+$'
        THEN CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO next_num
  FROM invoices;

  invoice_num := 'INV-' || LPAD(next_num::TEXT, 5, '0');

  RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;
```

## File Structure

### New Files

```
src/lib/invoiceBuilder/types.ts              # TypeScript interfaces
src/hooks/useInvoiceBuilder.ts               # Builder state management
src/components/invoices/InvoiceBuilderTab.tsx
src/components/invoices/InvoiceGroupingSelector.tsx
src/components/invoices/InvoicePreviewCard.tsx
src/components/invoices/InvoicePreviewList.tsx
src/components/invoices/SavedInvoicesTab.tsx
src/components/invoices/InvoiceDetailDialog.tsx
src/components/invoices/MarkPaidDialog.tsx
src/components/accounts/AccountInvoicesTab.tsx
src/components/reports/StorageGenerationSection.tsx
```

### Modified Files

```
src/components/reports/BillingReportTab.tsx  # Add Create Invoice button
src/components/reports/RevenueLedgerTab.tsx  # Tabbed interface (Builder, Saved, Storage)
src/hooks/useInvoices.ts                     # Add new functions
src/hooks/useTenantPreferences.ts            # Add new preference fields
src/components/accounts/AccountDialog.tsx    # Add Invoices tab
```

## Grouping Logic

| Account | Sidemark | ChargeType | Result |
|---------|----------|------------|--------|
| ✓ | ✗ | ✗ | One invoice per account |
| ✓ | ✓ | ✗ | One invoice per account+sidemark |
| ✓ | ✗ | ✓ | One invoice per account+chargeType |
| ✓ | ✓ | ✓ | Maximum granularity |
| ✗ | ✗ | ✗ | One invoice with ALL events |

## Payment Status

- `payment_status = 'partial'` when paid_amount < total_amount
- `payment_status = 'paid'` when paid_amount >= total_amount
- `status = 'paid'` only when fully paid

## UI Status Badge Colors

| Status | Class |
|--------|-------|
| Draft | `bg-yellow-100 text-yellow-800` |
| Sent | `bg-green-100 text-green-800` |
| Paid | `bg-blue-100 text-blue-800` |
| Void | `bg-gray-100 text-gray-500` |
| Partial | `bg-orange-100 text-orange-800` |

## Button States

| Button | Enabled When | Disabled When |
|--------|-------------|---------------|
| Create Invoice (Billing Report) | ≥1 unbilled event selected | No unbilled selected |
| Create Invoices (Builder) | ≥1 preview selected | No previews selected |
| Send Email | status = draft | Any other status |
| Mark Paid | status = sent AND full tracking | Otherwise |
| Void | status ≠ void AND ≠ paid | Already void/paid |

## Acceptance Criteria

### Billing Report Flow
- [ ] "Create Invoice" button appears in action bar
- [ ] Button shows count of unbilled selected
- [ ] Button disabled when no unbilled selected
- [ ] Clicking navigates to Invoice Builder with events param

### Invoice Builder
- [ ] Auto-activates when events param present
- [ ] Shows loading while fetching
- [ ] Shows empty state when no events
- [ ] Summary card shows count, total, accounts, date range
- [ ] Grouping presets work (4 buttons)
- [ ] Custom checkboxes work
- [ ] Preview count updates in real-time
- [ ] Preview cards show correct data
- [ ] Preview cards expand/collapse
- [ ] Notes field works
- [ ] Select/deselect works
- [ ] Create button shows count
- [ ] Create button disabled when none selected
- [ ] Creation shows loading state
- [ ] Success creates invoices correctly
- [ ] Success updates billing_events to invoiced
- [ ] Success navigates to Saved Invoices

### Saved Invoices
- [ ] Shows all invoices
- [ ] Filters work (account, status)
- [ ] Summary cards show correct totals
- [ ] Bulk selection works
- [ ] Bulk email works
- [ ] Bulk download works
- [ ] View detail works
- [ ] Send email works (draft only)
- [ ] Mark paid works (if enabled)
- [ ] Void works

### Invoice Numbers
- [ ] First invoice is INV-00001
- [ ] Numbers increment globally
- [ ] Numbers zero-padded to 5 digits

### Account Invoices Tab
- [ ] Tab appears in account detail
- [ ] Shows only that account's invoices
- [ ] View and download only (no edit)
