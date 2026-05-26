-- DT account verification fallback (2026-05-26)
--
-- Symptom: NIP-00127 was the first push to a brand-new tenant
-- (NIP TUCK REMODELING). The Supabase map had the tenant correctly mapped
-- to "NIP TUCK REMODELING", but DT's actual account was misspelled
-- "NIP TUCK REMODLING" (missing the second E). DT silently dropped the
-- account assignment (no error response — add_order succeeded with a
-- blank account). The order landed orphaned on DT.
--
-- Root cause gap: resolveAccountName() in dt-push-order only falls back
-- to STRIDE LOGISTICS when the tenant is UNMAPPED on our side. It cannot
-- detect that a mapped account name doesn't exist on DT's side.
--
-- Fix: track which tenants have been "verified" (operator confirms the
-- DT account exists and accepts pushes under that name). Unverified
-- tenants get pushed under STRIDE LOGISTICS as a safety fallback so the
-- order at least lands somewhere visible. Operator then fixes DT-side
-- (rename / create the account), manually verifies the tenant via a
-- one-line SQL update, and the next push uses the real mapped account.
--
-- Schema:
--   dt_credentials.verified_account_tenants jsonb DEFAULT '[]'
--     A JSON array of tenant_id strings. Tenants in this list push
--     under their mapped DT account name. Tenants NOT in this list
--     fall back to STRIDE LOGISTICS.
--
--   dt_orders.pushed_account_was_fallback boolean DEFAULT false
--     Stamped TRUE when the push used the STRIDE LOGISTICS fallback
--     instead of the tenant's mapped account. Drives the OrderPage
--     warning banner.
--
-- Backfill: tenants with >= 2 successful pushes are auto-verified.
-- The first-push-only tenants (likely the buggy case) stay unverified
-- so the safety net catches them. Specifically: NIP TUCK REMODELING
-- has exactly 1 pushed order (NIP-00127) and stays unverified by this
-- rule — the operator will verify it manually after fixing DT.
--
-- Manual verify SQL (run after fixing DT-side and confirming the account
-- exists EXACTLY as mapped):
--   UPDATE dt_credentials SET verified_account_tenants =
--     COALESCE(verified_account_tenants, '[]'::jsonb) || to_jsonb('<TENANT_ID>'::text);
-- To unverify (e.g., if you re-discover an issue):
--   UPDATE dt_credentials SET verified_account_tenants =
--     (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(verified_account_tenants) t WHERE t::text != '"<TENANT_ID>"');

-- Add the columns
ALTER TABLE dt_credentials
  ADD COLUMN IF NOT EXISTS verified_account_tenants jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dt_orders
  ADD COLUMN IF NOT EXISTS pushed_account_was_fallback boolean NOT NULL DEFAULT false;

-- Backfill verified list with tenants that have >= 2 successful pushes
-- (proxy for "this account has been working on DT side for a while")
WITH verified AS (
  SELECT jsonb_agg(DISTINCT tenant_id) AS list
  FROM (
    SELECT tenant_id
    FROM dt_orders
    WHERE tenant_id IS NOT NULL
      AND pushed_to_dt_at IS NOT NULL
    GROUP BY tenant_id
    HAVING COUNT(*) >= 2
  ) AS tenants_with_history
)
UPDATE dt_credentials
SET verified_account_tenants = COALESCE((SELECT list FROM verified), '[]'::jsonb);

-- Stamp NIP-00127 specifically — it's the order that triggered this
-- whole conversation. The fallback didn't exist yet when it was pushed,
-- but we know in retrospect it should have been flagged. Stamping it
-- now so the operator sees the warning banner when they open the page.
UPDATE dt_orders
SET pushed_account_was_fallback = true
WHERE dt_identifier = 'NIP-00127';
