import type { QuoteStoreSettings } from './quoteTypes';

// All pricing-grade defaults (DEFAULT_CLASSES, DEFAULT_SERVICES,
// DEFAULT_TAX_AREAS, DEFAULT_COVERAGE_OPTIONS) were removed on
// 2026-04-26. The price list (Settings → Pricing) is now the single
// source of truth for every rate, class, tax area, and coverage
// option. If Supabase returns empty for any of those tables the
// Quote Tool now shows an explicit "Pricing data unavailable" state
// instead of silently using stale literals.
//
// What stays here is non-pricing UI defaults (company name, prefix,
// initial quote number) — these are bootstrap values for a brand-new
// localStorage and do not affect billing.

export const DEFAULT_SETTINGS: QuoteStoreSettings = {
  companyName: 'Stride Logistics',
  companyAddress: '625 Industry Dr, Tukwila, WA 98188',
  companyPhone: '(253) 200-1432',
  companyEmail: 'whse@stridenw.com',
  defaultExpirationDays: 30,
  defaultStorageMonths: 1,
  defaultTaxAreaId: '', // resolved from tax_areas after the catalog loads
  quotePrefix: 'EST',
  nextQuoteNumber: 1000,
};
