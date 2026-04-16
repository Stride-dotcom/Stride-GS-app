
-- Fix 1: Enable RLS on tables missing it
ALTER TABLE public.task_status_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_type_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_fallback_log ENABLE ROW LEVEL SECURITY;

-- These are lookup/map tables - allow all authenticated users to read
CREATE POLICY "Authenticated users can read task_status_map"
  ON public.task_status_map FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read task_type_map"
  ON public.task_type_map FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read release_type_map"
  ON public.release_type_map FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- pricing_fallback_log is tenant-scoped
CREATE POLICY "Users can read own tenant pricing_fallback_log"
  ON public.pricing_fallback_log FOR SELECT
  USING (tenant_id = public.user_tenant_id());

CREATE POLICY "Users can insert own tenant pricing_fallback_log"
  ON public.pricing_fallback_log FOR INSERT
  WITH CHECK (tenant_id = public.user_tenant_id());

-- Fix 2: Recreate views with security_invoker = true
-- v_tasks_canonical
CREATE OR REPLACE VIEW public.v_tasks_canonical
WITH (security_invoker = true) AS
SELECT id, tenant_id, warehouse_id, task_type, title, description, status, priority,
  assigned_to, related_item_id, due_date, completed_at, completed_by, metadata,
  created_at, updated_at, deleted_at, account_id, billing_date, billing_status,
  invoice_id, service_date, assigned_department, pallet_sale_applied,
  minor_touchup_applied, custom_packaging_applied, billing_charge_date,
  parent_task_id, task_type_id, unable_to_complete_note, bill_to,
  bill_to_customer_name, bill_to_customer_email, unable_to_complete,
  unable_to_complete_reason, unable_to_complete_at, unable_to_complete_by,
  started_at, ended_at, duration_minutes, started_by, ended_by,
  overdue_alert_sent_at, sidemark, billing_rate, billing_rate_locked,
  billing_rate_set_by, billing_rate_set_at,
  canonicalize_task_status(status) AS status_canonical,
  canonicalize_task_type(task_type) AS task_type_canonical
FROM tasks t;

-- v_shipments_canonical
CREATE OR REPLACE VIEW public.v_shipments_canonical
WITH (security_invoker = true) AS
SELECT id, tenant_id, shipment_number, shipment_type, status, account_id,
  warehouse_id, expected_arrival_date, carrier, tracking_number, po_number,
  release_type, bill_to, release_to_name, release_to_phone, release_to_email,
  signature_data, signature_name, signature_timestamp, payment_amount,
  payment_status, payment_method, payment_reference, received_at, completed_at,
  created_at, updated_at, deleted_at, created_by, completed_by, notes, metadata,
  receiving_documents, receiving_photos, receiving_notes, return_type,
  sidemark_id, sidemark, outbound_type_id, driver_name, liability_accepted,
  shipped_at, highlight_notes,
  canonicalize_release_type(release_type) AS release_type_canonical
FROM shipments s;

-- v_account_credit_balance
CREATE OR REPLACE VIEW public.v_account_credit_balance
WITH (security_invoker = true) AS
SELECT ac.tenant_id, ac.account_id, a.account_name,
  sum(CASE WHEN ac.status = 'active' THEN COALESCE(ac.balance_remaining, ac.amount) ELSE 0 END) AS available_credit,
  sum(ac.amount) AS total_credits_issued,
  sum(COALESCE(ca.total_applied, 0)) AS total_credits_applied,
  count(CASE WHEN ac.status = 'active' THEN 1 ELSE NULL END) AS active_credits_count
FROM account_credits ac
  JOIN accounts a ON a.id = ac.account_id
  LEFT JOIN (
    SELECT credit_id, sum(amount_applied) AS total_applied
    FROM credit_applications
    GROUP BY credit_id
  ) ca ON ca.credit_id = ac.id
WHERE ac.voided_at IS NULL
GROUP BY ac.tenant_id, ac.account_id, a.account_name;

-- v_manifest_stats (need to see the full definition first)
