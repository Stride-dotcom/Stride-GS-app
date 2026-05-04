-- Migration: billable_event_coverage view
--
-- One row per "potentially billable event" in the system, LEFT-JOINed
-- against the billing ledger so we can spot events that should have
-- produced a charge but didn't.
--
-- Sources:
--   - Completed tasks (INSP/ASM/LABEL/DISP/PLLT/etc.)
--   - Complete repairs (status = 'Complete' with final_amount > 0)
--   - Released non-COD will calls (one event per released item)
--   - Inventory items with receive_date set (RCVG)
--
-- Classification:
--   - BILLED  — matching billing row exists (joined on the canonical
--               ledger_row_id format for that event type)
--   - MISSING — no matching billing row, but event passed the
--               "expected to bill" filter
--   - SKIPPED — event present but intentionally skipped (COD WC,
--               IMP-/SHP-MIGRATED- shipments, demo tenant, billing
--               disabled at client level, etc.)
--
-- The page consuming this view does the visual filtering. The view's
-- job is just: enumerate every event + report whether the ledger has
-- a corresponding row.

CREATE OR REPLACE VIEW billable_event_coverage AS

-- ══ Tasks ══════════════════════════════════════════════════════════════════
SELECT
  'task'::text                                    AS source,
  t.tenant_id,
  c.name                                          AS client_name,
  t.task_id                                       AS event_id,
  t.type                                          AS svc_code,
  t.item_id,
  t.completed_at                                  AS event_date,
  t.result,
  t.shipment_number,
  COALESCE(t.type, '') || '-TASK-' || t.task_id   AS expected_ledger_id,
  CASE
    -- Demo tenant — ignore
    WHEN t.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'SKIPPED'
    WHEN b.ledger_row_id IS NOT NULL THEN 'BILLED'
    ELSE 'MISSING'
  END                                             AS event_status,
  b.ledger_row_id,
  b.status                                        AS billing_status,
  b.invoice_no,
  b.total                                         AS billed_total,
  CASE
    WHEN t.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'demo tenant'
    WHEN COALESCE(t.shipment_number, '') LIKE 'SHP-MIGRATED-%' THEN 'migrated shipment'
    WHEN t.result = 'Fail' THEN 'failed task — may not bill (depends on price list)'
    WHEN t.custom_price = '0' OR t.custom_price = '0.00' THEN 'custom price = 0 (operator override)'
    ELSE NULL
  END                                             AS skip_reason
FROM tasks t
LEFT JOIN clients c ON c.tenant_id = t.tenant_id
LEFT JOIN billing b ON b.tenant_id = t.tenant_id AND b.task_id = t.task_id
WHERE t.status = 'Completed'

UNION ALL

-- ══ Repairs ════════════════════════════════════════════════════════════════
SELECT
  'repair'::text                                  AS source,
  r.tenant_id,
  c.name                                          AS client_name,
  r.repair_id                                     AS event_id,
  'REPAIR'::text                                  AS svc_code,
  r.item_id,
  r.completed_date                                AS event_date,
  r.repair_result                                 AS result,
  NULL::text                                      AS shipment_number,
  'REPAIR-' || r.repair_id                        AS expected_ledger_id,
  CASE
    WHEN r.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'SKIPPED'
    WHEN b.ledger_row_id IS NOT NULL THEN 'BILLED'
    ELSE 'MISSING'
  END                                             AS event_status,
  b.ledger_row_id,
  b.status                                        AS billing_status,
  b.invoice_no,
  b.total                                         AS billed_total,
  CASE
    WHEN r.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'demo tenant'
    ELSE NULL
  END                                             AS skip_reason
FROM repairs r
LEFT JOIN clients c ON c.tenant_id = r.tenant_id
LEFT JOIN billing b ON b.tenant_id = r.tenant_id AND b.repair_id = r.repair_id
WHERE r.status = 'Complete'

UNION ALL

-- ══ Will Call items ════════════════════════════════════════════════════════
-- One event per released item (joined to wc_items). cod=true is intentionally
-- skipped by handleProcessWcRelease_ — show as SKIPPED so the operator can
-- still audit them.
SELECT
  'will_call'::text                               AS source,
  w.tenant_id,
  c.name                                          AS client_name,
  wi.item_id || ' @ ' || w.wc_number              AS event_id,
  'WC'::text                                      AS svc_code,
  wi.item_id,
  w.actual_pickup_date::text                      AS event_date,
  w.status                                        AS result,
  w.wc_number                                     AS shipment_number,
  'WC-' || wi.item_id || '-' || w.wc_number       AS expected_ledger_id,
  CASE
    WHEN w.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'SKIPPED'
    WHEN w.cod = true THEN 'SKIPPED'
    WHEN b.ledger_row_id IS NOT NULL THEN 'BILLED'
    ELSE 'MISSING'
  END                                             AS event_status,
  b.ledger_row_id,
  b.status                                        AS billing_status,
  b.invoice_no,
  b.total                                         AS billed_total,
  CASE
    WHEN w.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'demo tenant'
    WHEN w.cod = true AND w.notes ILIKE '%[COD Paid%' THEN 'COD — payment collected outside ledger'
    WHEN w.cod = true THEN 'COD — billing intentionally suppressed'
    ELSE NULL
  END                                             AS skip_reason
FROM will_calls w
JOIN will_call_items wi
  ON wi.tenant_id = w.tenant_id AND wi.wc_number = w.wc_number
LEFT JOIN clients c ON c.tenant_id = w.tenant_id
LEFT JOIN billing b
  ON b.tenant_id = w.tenant_id
 AND b.svc_code = 'WC'
 AND b.item_id = wi.item_id
 AND b.shipment_number = w.wc_number
WHERE w.status IN ('Released', 'Partial')
  AND COALESCE(wi.status, '') = 'Released'

UNION ALL

-- ══ Receiving (RCVG) ═══════════════════════════════════════════════════════
-- Items received via the in-app receiving flow. IMP- and SHP-MIGRATED-
-- prefixed shipments are imports — receiving was billed in the prior
-- system, so we show those as SKIPPED. Clients with
-- enable_receiving_billing=false are also SKIPPED.
SELECT
  'inventory'::text                               AS source,
  i.tenant_id,
  c.name                                          AS client_name,
  i.item_id                                       AS event_id,
  'RCVG'::text                                    AS svc_code,
  i.item_id,
  i.receive_date                                  AS event_date,
  i.status                                        AS result,
  i.shipment_number,
  'RCVG-' || i.item_id || '-' || COALESCE(i.shipment_number, '') AS expected_ledger_id,
  CASE
    WHEN i.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'SKIPPED'
    WHEN COALESCE(c.enable_receiving_billing, true) = false THEN 'SKIPPED'
    WHEN COALESCE(i.shipment_number, '') LIKE 'IMP-%' THEN 'SKIPPED'
    WHEN COALESCE(i.shipment_number, '') LIKE 'SHP-MIGRATED-%' THEN 'SKIPPED'
    WHEN b.ledger_row_id IS NOT NULL THEN 'BILLED'
    ELSE 'MISSING'
  END                                             AS event_status,
  b.ledger_row_id,
  b.status                                        AS billing_status,
  b.invoice_no,
  b.total                                         AS billed_total,
  CASE
    WHEN i.tenant_id = '1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A' THEN 'demo tenant'
    WHEN COALESCE(c.enable_receiving_billing, true) = false THEN 'client billing disabled'
    WHEN COALESCE(i.shipment_number, '') LIKE 'IMP-%' THEN 'imported (not received in-app)'
    WHEN COALESCE(i.shipment_number, '') LIKE 'SHP-MIGRATED-%' THEN 'migrated from prior system'
    ELSE NULL
  END                                             AS skip_reason
FROM inventory i
LEFT JOIN clients c ON c.tenant_id = i.tenant_id
LEFT JOIN billing b ON b.tenant_id = i.tenant_id AND b.svc_code = 'RCVG' AND b.item_id = i.item_id
WHERE COALESCE(i.receive_date, '') <> '';


-- Read access: same RLS-style as the underlying tables. The view has no
-- RLS of its own; callers using the service role key (Apps Script + the
-- React app via Supabase client with appropriate auth) see all rows.
-- For per-tenant scoping, callers filter ON tenant_id at query time.
GRANT SELECT ON billable_event_coverage TO anon, authenticated, service_role;
