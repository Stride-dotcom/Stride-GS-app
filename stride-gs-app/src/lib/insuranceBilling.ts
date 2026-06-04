/**
 * Insurance billing date helpers.
 *
 * Stride coverage is billed in 30-day cycles, but a client's FIRST
 * billing period is anchored to the 1st of the next calendar month so a
 * mid-month signup only pays for the partial remainder of their first
 * month. The daily `insurance_bill_due()` cron then prorates that first
 * period day-for-day (days from inception → next_billing_date, over 30).
 * After the first (possibly partial) period, the cron advances by a flat
 * 30 days.
 *
 * Keep this in sync with the inline copy in
 * `supabase/functions/apply-intake-on-submit/index.ts` (Edge Functions
 * can't import from src/).
 */

/** YYYY-MM-DD (local components, timezone-safe) for the 1st of the month
 *  AFTER the given date. Used as the first next_billing_date so the first
 *  insurance charge is prorated for the partial signup month. */
export function firstBillingAnchor(from: Date = new Date()): string {
  const y = from.getFullYear();
  const m = from.getMonth(); // 0-based
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1; // 0-based month of the anchor
  return `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
}
