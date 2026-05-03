-- One-shot backfill of public.autocomplete_db from data already in
-- public.inventory and public.billing. Per Justin: existing
-- runAutocompleteBackfill() walks each client's Autocomplete_DB sheet,
-- which was missing values added through paths that bypassed
-- logAutocompleteEntries_() (inline edits on the React side, imports,
-- transfers, manual charges). The sheet was stale even when synced.
-- This backfill goes straight from the authoritative mirror tables, so
-- it captures everything the user has actually entered for each client.
--
-- Idempotent: autocomplete_db PK is (tenant_id, field, value), so
-- ON CONFLICT DO NOTHING merges with whatever's already there.
--
-- Pre-backfill counts (2026-05-03):
--   Description   191 rows /  2 tenants
--   Sidemark       12 rows /  2 tenants
--   Vendor         65 rows /  2 tenants
--
-- Post-backfill counts:
--   Description 3,383 rows / 49 tenants
--   Sidemark      688 rows / 49 tenants
--   Vendor      1,008 rows / 47 tenants

INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT i.tenant_id, 'Sidemark', TRIM(i.sidemark)
  FROM public.inventory i
 WHERE NULLIF(TRIM(i.sidemark), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;

INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT b.tenant_id, 'Sidemark', TRIM(b.sidemark)
  FROM public.billing b
 WHERE NULLIF(TRIM(b.sidemark), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;

INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT i.tenant_id, 'Vendor', TRIM(i.vendor)
  FROM public.inventory i
 WHERE NULLIF(TRIM(i.vendor), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;

INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT i.tenant_id, 'Description', TRIM(i.description)
  FROM public.inventory i
 WHERE NULLIF(TRIM(i.description), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;
