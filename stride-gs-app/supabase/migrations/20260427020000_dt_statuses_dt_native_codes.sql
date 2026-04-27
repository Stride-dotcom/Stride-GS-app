-- 20260427020000_dt_statuses_dt_native_codes.sql
--
-- Adds dt_statuses rows for the DT-native status codes the live
-- DispatchTrack instance returns from /orders/api/export.xml. Until
-- now the canonical seed only had Stride-side codes (new, scheduled,
-- started, finished, …) so any DT response with codes like "READY TO
-- ROUTE", "SCHEDULE EXCEPTION", or "CANCELED" failed the
-- statusByCode lookup in dt-sync-statuses and left status_id null —
-- which surfaced as orders permanently stuck in "Awaiting DT Sync"
-- in the UI even though the sync itself was running and writing
-- dt_status_code on the row.
--
-- The sync function uppercases both sides before lookup, so the
-- code column here must contain the DT spelling exactly (spaces
-- and all). Categories follow the existing convention so the
-- Orders-page Open/Exception filters bucket these rows correctly.
--
-- Display orders are slotted into the existing seed gaps so the
-- in-app status dropdown reads top-down without re-shuffling
-- existing rows.

INSERT INTO public.dt_statuses (id, code, name, category, display_order, color) VALUES
  (30, 'READY TO ROUTE',     'Ready to Route',     'open',      13, '#8b5cf6'),
  (31, 'SCHEDULE EXCEPTION', 'Schedule Exception', 'exception', 14, '#f59e0b'),
  (32, 'CANCELED',            'Canceled',           'cancelled', 15, '#94a3b8'),
  -- Common DT spelling variants — keep both so the lookup hits
  -- whether the instance uses American "Canceled" or British
  -- "Cancelled". Cheaper than normalizing in the sync function.
  (33, 'CANCELLED',           'Canceled',           'cancelled', 16, '#94a3b8')
ON CONFLICT (id) DO NOTHING;
