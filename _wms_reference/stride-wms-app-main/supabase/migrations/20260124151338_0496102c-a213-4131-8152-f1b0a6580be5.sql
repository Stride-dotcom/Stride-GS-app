-- Security hardening: set a fixed search_path on functions flagged by the linter
-- This prevents search_path injection risks.

ALTER FUNCTION public.generate_item_code() SET search_path = public;
ALTER FUNCTION public.generate_item_code(uuid) SET search_path = public;
ALTER FUNCTION public.generate_storage_for_date(date) SET search_path = public;
ALTER FUNCTION public.next_invoice_number() SET search_path = public;
ALTER FUNCTION public.set_item_code() SET search_path = public;