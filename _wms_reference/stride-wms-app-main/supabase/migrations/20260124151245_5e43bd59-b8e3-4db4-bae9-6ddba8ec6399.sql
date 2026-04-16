-- Fix 1: documents INSERT policy should use user_tenant_id() (more reliable than querying public.users)
DROP POLICY IF EXISTS "Users can insert documents for their tenant" ON public.documents;
CREATE POLICY "Users can insert documents for their tenant"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.user_tenant_id()
  AND created_by = auth.uid()
);

-- Fix 2: Add missing foreign keys so PostgREST can resolve relationships (prevents PGRST200)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_events_account_id_fkey'
      AND conrelid = 'public.billing_events'::regclass
  ) THEN
    ALTER TABLE public.billing_events
      ADD CONSTRAINT billing_events_account_id_fkey
      FOREIGN KEY (account_id)
      REFERENCES public.accounts(id)
      ON DELETE SET NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'repair_quotes_technician_user_id_fkey'
      AND conrelid = 'public.repair_quotes'::regclass
  ) THEN
    ALTER TABLE public.repair_quotes
      ADD CONSTRAINT repair_quotes_technician_user_id_fkey
      FOREIGN KEY (technician_user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Optional but helpful: approval user FK (prevents future relationship errors)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'repair_quotes_approved_by_fkey'
      AND conrelid = 'public.repair_quotes'::regclass
  ) THEN
    ALTER TABLE public.repair_quotes
      ADD CONSTRAINT repair_quotes_approved_by_fkey
      FOREIGN KEY (approved_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;