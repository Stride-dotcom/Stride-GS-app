
-- Fix remaining Security Definer Views

-- v_claims_with_items
CREATE OR REPLACE VIEW public.v_claims_with_items
WITH (security_invoker = true) AS
SELECT c.id, c.tenant_id, c.claim_number, c.account_id, c.sidemark_id, c.item_id,
  c.shipment_id, c.claim_type, c.status, c.description, c.claimed_amount,
  c.approved_amount, c.coverage_type, c.deductible, c.filed_by, c.filed_at,
  c.resolved_by, c.resolved_at, c.resolution_notes, c.photos, c.documents,
  c.created_at, c.updated_at, c.deleted_at, c.non_inventory_ref,
  c.incident_location, c.incident_contact_name, c.incident_contact_phone,
  c.incident_contact_email, c.coverage_snapshot, c.claim_value_requested,
  c.claim_value_calculated, c.deductible_applied, c.approved_payout_amount,
  c.payout_method, c.payout_reference, c.requires_manager_approval,
  c.determination_sent_at, c.settlement_terms_version, c.settlement_terms_text,
  c.settlement_acceptance_required, c.settlement_accepted_at,
  c.settlement_accepted_by, c.assigned_to, c.incident_date, c.public_notes,
  c.internal_notes, c.client_initiated, c.total_requested_amount,
  c.total_approved_amount, c.total_deductible, c.acceptance_token,
  c.acceptance_token_expires_at, c.status_before_acceptance,
  c.sent_for_acceptance_at, c.sent_for_acceptance_by, c.settlement_accepted_ip,
  c.settlement_declined_at, c.settlement_declined_by, c.decline_reason,
  c.counter_offer_amount, c.counter_offer_notes, c.requires_admin_approval,
  c.admin_approved_at, c.admin_approved_by, c.admin_approval_notes,
  c.repair_task_created_id,
  COALESCE(ci_stats.item_count, 0::bigint) AS item_count,
  COALESCE(ci_stats.total_requested, 0::numeric) AS items_total_requested,
  COALESCE(ci_stats.total_approved, 0::numeric) AS items_total_approved,
  a.account_name,
  s.sidemark_name
FROM claims c
  LEFT JOIN accounts a ON a.id = c.account_id
  LEFT JOIN sidemarks s ON s.id = c.sidemark_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS item_count,
      sum(claim_items.requested_amount) AS total_requested,
      sum(claim_items.approved_amount) AS total_approved
    FROM claim_items
    WHERE claim_items.claim_id = c.id
  ) ci_stats ON true
WHERE c.deleted_at IS NULL;

-- v_manifest_stats
CREATE OR REPLACE VIEW public.v_manifest_stats
WITH (security_invoker = true) AS
SELECT m.id AS manifest_id, m.manifest_number, m.name, m.status,
  m.expected_item_count, m.scanned_item_count,
  m.expected_item_count - m.scanned_item_count AS remaining_items,
  CASE
    WHEN m.expected_item_count > 0 THEN round(m.scanned_item_count::numeric / m.expected_item_count::numeric * 100::numeric, 1)
    ELSE 0::numeric
  END AS progress_percent,
  COALESCE(scan_stats.valid_scans, 0::bigint) AS valid_scans,
  COALESCE(scan_stats.rejected_scans, 0::bigint) AS rejected_scans,
  COALESCE(scan_stats.duplicate_scans, 0::bigint) AS duplicate_scans,
  m.created_by, m.created_at, m.started_by, m.started_at,
  m.completed_by, m.completed_at
FROM stocktake_manifests m
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ms.scan_result = 'valid') AS valid_scans,
      count(*) FILTER (WHERE ms.scan_result = 'not_on_manifest') AS rejected_scans,
      count(*) FILTER (WHERE ms.scan_result = 'duplicate') AS duplicate_scans
    FROM stocktake_manifest_scans ms
    WHERE ms.manifest_id = m.id
  ) scan_stats ON true;
