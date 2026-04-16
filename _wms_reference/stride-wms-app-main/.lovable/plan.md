

## Fix Quote PDF: Missing Discount, Missing Valuation Coverage, Logo Spacing

### Problems Identified

1. **Discount not showing**: `buildExportData()` passes `...quote` (saved DB state) to `transformQuoteToPdfData`, but the live calculation results (from the `calculation` object) aren't used for subtotals/discount. The saved quote may have stale or zero values for `subtotal_before_discounts` and `subtotal_after_discounts`, so the discount line never renders.

2. **Valuation Coverage not showing**: The `QuotePdfData` interface has no coverage fields, and the PDF renderer has no coverage line. Coverage was added to the calculator and UI but never wired into the export.

3. **Logo touching divider**: The divider line is drawn at `y` after company info, but when a logo is present the vertical spacing (`y += 4` before divider) isn't enough to clear the logo height.

### Changes

**File: `src/lib/quotes/export.ts`**
- Add `coverageType`, `coverageCost` fields to `QuotePdfData` interface
- In `generateQuotePdf`: add a "Valuation Coverage" line in the totals section (between tax and the grand total line), rendered only when `coverageCost > 0`
- In `generateQuotePdf`: increase spacing before the divider line by ~4pt to prevent logo overlap
- In `transformQuoteToPdfData`: pass through `coverage_type` and `coverage_cost` from quote

**File: `src/pages/QuoteBuilder.tsx`**
- In `buildExportData()`: override the PDF data's `subtotal`, `discountAmount`, `discountType`, `discountValue`, `taxAmount`, `taxRate`, `grandTotal`, `coverageType`, and `coverageCost` from the live `calculation` object instead of relying on stale saved quote values

### Technical Details

The `calculation` object (from `calculateQuote()`) contains all correct live values:
- `subtotal_before_discounts`, `quote_discount_amount`, `subtotal_after_discounts`
- `tax_amount`, `coverage_cost`, `coverage_type`, `grand_total`

These will be merged into the `QuotePdfData` after `transformQuoteToPdfData` returns, ensuring the PDF always reflects the current state shown in the Quote Summary panel.

