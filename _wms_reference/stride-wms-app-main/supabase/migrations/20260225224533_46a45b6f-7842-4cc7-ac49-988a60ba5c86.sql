UPDATE public.app_issues
SET status = 'fixed'
WHERE status = 'new'
  AND (
    error_message ILIKE '%Invalid Refresh Token%'
    OR error_message ILIKE '%shipment_notes%'
    OR error_message ILIKE '%Could not find the table%public.photos%'
    OR error_message ILIKE '%rpc_admin_list_platform_alert_templates%'
  )