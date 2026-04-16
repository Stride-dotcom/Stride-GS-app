-- =============================================================================
-- Unified Notes Module - Core schema, migration, and compatibility
-- =============================================================================
-- This migration introduces:
--   1) Canonical notes model: public.notes + public.note_entity_links
--   2) Mentions support tables: public.note_mentions + public.note_audit_log
--   3) Username support for @mentions on public.users
--   4) Legacy backfill from shipment/item/task + legacy single-field notes
--   5) Compatibility sync from shipment_notes -> notes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Client portal helpers (idempotent safety)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_portal_account_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT account_id INTO v_account_id
    FROM public.client_portal_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
    LIMIT 1;

    RETURN v_account_id;
EXCEPTION
    WHEN undefined_table THEN
        RETURN NULL;
    WHEN OTHERS THEN
        RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_client_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.client_portal_users
        WHERE auth_user_id = auth.uid()
          AND is_active = true
    );
EXCEPTION
    WHEN undefined_table THEN
        RETURN false;
    WHEN OTHERS THEN
        RETURN false;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Canonical notes tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note text NOT NULL,
  note_type text NOT NULL DEFAULT 'internal',
  visibility text NOT NULL DEFAULT 'internal',
  parent_note_id uuid REFERENCES public.notes(id),
  root_note_id uuid REFERENCES public.notes(id),
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  source_entity_number text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id),
  edited_by uuid REFERENCES public.users(id),
  edited_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS note_type text DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS parent_note_id uuid,
  ADD COLUMN IF NOT EXISTS root_note_id uuid,
  ADD COLUMN IF NOT EXISTS source_entity_type text,
  ADD COLUMN IF NOT EXISTS source_entity_id uuid,
  ADD COLUMN IF NOT EXISTS source_entity_number text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_note_type_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_note_type_check
  CHECK (note_type IN ('internal', 'public', 'exception')) NOT VALID;

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_visibility_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_visibility_check
  CHECK (visibility IN ('internal', 'public')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.note_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_number text,
  link_kind text NOT NULL DEFAULT 'related',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(note_id, entity_type, entity_id, link_kind)
);

ALTER TABLE public.note_entity_links
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS note_id uuid,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS entity_number text,
  ADD COLUMN IF NOT EXISTS link_kind text DEFAULT 'related',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.note_entity_links
  DROP CONSTRAINT IF EXISTS note_entity_links_link_kind_check;
ALTER TABLE public.note_entity_links
  ADD CONSTRAINT note_entity_links_link_kind_check
  CHECK (link_kind IN ('source', 'related')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.note_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mention_username text NOT NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(note_id, mentioned_user_id)
);

CREATE TABLE IF NOT EXISTS public.note_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id),
  before_note text,
  after_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.note_audit_log
  DROP CONSTRAINT IF EXISTS note_audit_log_action_check;
ALTER TABLE public.note_audit_log
  ADD CONSTRAINT note_audit_log_action_check
  CHECK (action IN ('created', 'updated', 'deleted', 'mention_added')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_notes_tenant_entity_root
  ON public.notes (tenant_id, source_entity_type, source_entity_id, root_note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_parent
  ON public.notes (parent_note_id);
CREATE INDEX IF NOT EXISTS idx_notes_root
  ON public.notes (root_note_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notes_note_type
  ON public.notes (tenant_id, note_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_not_deleted
  ON public.notes (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_note_entity_links_lookup
  ON public.note_entity_links (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_entity_links_note
  ON public.note_entity_links (note_id);

CREATE INDEX IF NOT EXISTS idx_note_mentions_note
  ON public.note_mentions (note_id);
CREATE INDEX IF NOT EXISTS idx_note_mentions_user
  ON public.note_mentions (tenant_id, mentioned_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_audit_note
  ON public.note_audit_log (note_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.normalize_unified_note_type(p_note_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(nullif(btrim(p_note_type), ''), 'internal'))
    WHEN 'public' THEN 'public'
    WHEN 'client' THEN 'public'
    WHEN 'external' THEN 'public'
    WHEN 'exception' THEN 'exception'
    WHEN 'error' THEN 'exception'
    WHEN 'warning' THEN 'exception'
    WHEN 'issue' THEN 'exception'
    ELSE 'internal'
  END
$function$;

-- -----------------------------------------------------------------------------
-- Username support for @mentions
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS username_is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS username_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username_unique
  ON public.users (tenant_id, lower(username))
  WHERE username IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.build_username_base(
  p_first_name text,
  p_last_name text,
  p_email text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_base text;
  v_email_local text;
BEGIN
  v_base := lower(
    regexp_replace(
      trim(both '_' from concat_ws('_', coalesce(p_first_name, ''), coalesce(p_last_name, ''))),
      '[^a-z0-9_]+',
      '_',
      'g'
    )
  );

  v_base := trim(both '_' from v_base);

  IF coalesce(v_base, '') = '' AND p_email IS NOT NULL THEN
    v_email_local := split_part(lower(p_email), '@', 1);
    v_base := trim(both '_' from regexp_replace(v_email_local, '[^a-z0-9_]+', '_', 'g'));
  END IF;

  IF coalesce(v_base, '') = '' THEN
    v_base := 'user';
  END IF;

  RETURN v_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_unique_username(
  p_tenant_id uuid,
  p_base text,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
  v_exists boolean;
BEGIN
  v_base := trim(both '_' from lower(regexp_replace(coalesce(p_base, 'user'), '[^a-z0-9_]+', '_', 'g')));
  IF v_base = '' THEN
    v_base := 'user';
  END IF;

  LOOP
    IF v_suffix = 0 THEN
      v_candidate := v_base;
    ELSE
      v_candidate := v_base || '_' || v_suffix::text;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.tenant_id = p_tenant_id
        AND lower(u.username) = lower(v_candidate)
        AND u.deleted_at IS NULL
        AND (p_exclude_user_id IS NULL OR u.id <> p_exclude_user_id)
    ) INTO v_exists;

    EXIT WHEN NOT v_exists;
    v_suffix := v_suffix + 1;
  END LOOP;

  RETURN v_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_users_ensure_username()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_base text;
  v_name_changed boolean;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_name_changed := (
    TG_OP = 'INSERT'
    OR coalesce(NEW.first_name, '') <> coalesce(OLD.first_name, '')
    OR coalesce(NEW.last_name, '') <> coalesce(OLD.last_name, '')
    OR coalesce(NEW.email, '') <> coalesce(OLD.email, '')
  );

  IF coalesce(NEW.username_is_manual, false) = true AND coalesce(NEW.username, '') <> '' THEN
    NEW.username := lower(trim(both '_' from regexp_replace(NEW.username, '[^a-zA-Z0-9_]+', '_', 'g')));
  ELSE
    IF TG_OP = 'INSERT' OR NEW.username IS NULL OR NEW.username = '' OR v_name_changed THEN
      v_base := public.build_username_base(NEW.first_name, NEW.last_name, NEW.email);
      NEW.username := public.generate_unique_username(NEW.tenant_id, v_base, NEW.id);
      NEW.username_is_manual := false;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR coalesce(NEW.username, '') <> coalesce(OLD.username, '') THEN
    NEW.username_updated_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_ensure_username ON public.users;
CREATE TRIGGER trg_users_ensure_username
  BEFORE INSERT OR UPDATE OF first_name, last_name, email, username, username_is_manual, tenant_id
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_ensure_username();

-- Backfill usernames for existing users missing one
WITH target_users AS (
  SELECT
    u.id,
    u.tenant_id,
    public.build_username_base(u.first_name, u.last_name, u.email) AS base
  FROM public.users u
  WHERE u.deleted_at IS NULL
    AND (u.username IS NULL OR btrim(u.username) = '')
)
UPDATE public.users u
SET
  username = public.generate_unique_username(t.tenant_id, t.base, t.id),
  username_is_manual = false,
  username_updated_at = now()
FROM target_users t
WHERE u.id = t.id;

-- -----------------------------------------------------------------------------
-- Unified note helpers and RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_unified_entity_number(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_number text;
BEGIN
  IF p_entity_type = 'shipment' THEN
    SELECT shipment_number INTO v_number FROM public.shipments WHERE id = p_entity_id;
  ELSIF p_entity_type = 'task' THEN
    -- task_number is not present in every deployed task schema.
    -- Resolve dynamically so this migration can run across older environments.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND column_name = 'task_number'
    ) THEN
      EXECUTE 'SELECT task_number FROM public.tasks WHERE id = $1'
      INTO v_number
      USING p_entity_id;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND column_name = 'title'
    ) THEN
      EXECUTE 'SELECT title FROM public.tasks WHERE id = $1'
      INTO v_number
      USING p_entity_id;
    ELSE
      SELECT id::text INTO v_number FROM public.tasks WHERE id = p_entity_id;
    END IF;
  ELSIF p_entity_type = 'item' THEN
    SELECT item_code INTO v_number FROM public.items WHERE id = p_entity_id;
  ELSIF p_entity_type = 'claim' THEN
    SELECT claim_number INTO v_number FROM public.claims WHERE id = p_entity_id;
  ELSIF p_entity_type = 'quote' THEN
    SELECT quote_number INTO v_number FROM public.quotes WHERE id = p_entity_id;
  ELSIF p_entity_type = 'stocktake' THEN
    SELECT stocktake_number INTO v_number FROM public.stocktakes WHERE id = p_entity_id;
  ELSIF p_entity_type = 'repair_quote' THEN
    SELECT coalesce('RPQ-' || substring(id::text, 1, 8), id::text) INTO v_number FROM public.repair_quotes WHERE id = p_entity_id;
  END IF;

  RETURN v_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unified_note_can_manage(
  p_note_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.id = p_note_id
      AND n.tenant_id = public.user_tenant_id()
      AND (
        n.created_by = p_user_id
        OR public.has_role(p_user_id, 'admin')
        OR public.has_role(p_user_id, 'manager')
        OR public.has_role(p_user_id, 'billing_manager')
        OR public.has_role(p_user_id, 'admin_dev')
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.unified_note_attach_links(
  p_note_id uuid,
  p_tenant_id uuid,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_source_entity_number text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_source_number text;
BEGIN
  v_source_number := coalesce(
    nullif(trim(coalesce(p_source_entity_number, '')), ''),
    public.resolve_unified_entity_number(p_source_entity_type, p_source_entity_id)
  );

  INSERT INTO public.note_entity_links (
    tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
  ) VALUES (
    p_tenant_id, p_note_id, p_source_entity_type, p_source_entity_id, v_source_number, 'source'
  )
  ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO UPDATE
    SET entity_number = EXCLUDED.entity_number;

  IF p_source_entity_type = 'shipment' THEN
    INSERT INTO public.note_entity_links (tenant_id, note_id, entity_type, entity_id, entity_number, link_kind)
    SELECT
      p_tenant_id,
      p_note_id,
      'item',
      i.id,
      i.item_code,
      'related'
    FROM public.items i
    WHERE i.tenant_id = p_tenant_id
      AND i.receiving_shipment_id = p_source_entity_id
      AND i.deleted_at IS NULL
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;
  ELSIF p_source_entity_type = 'task' THEN
    INSERT INTO public.note_entity_links (tenant_id, note_id, entity_type, entity_id, entity_number, link_kind)
    SELECT
      p_tenant_id,
      p_note_id,
      'item',
      i.id,
      i.item_code,
      'related'
    FROM public.task_items ti
    JOIN public.items i ON i.id = ti.item_id
    WHERE i.tenant_id = p_tenant_id
      AND ti.task_id = p_source_entity_id
      AND i.deleted_at IS NULL
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;
  ELSIF p_source_entity_type = 'claim' THEN
    INSERT INTO public.note_entity_links (tenant_id, note_id, entity_type, entity_id, entity_number, link_kind)
    SELECT
      p_tenant_id,
      p_note_id,
      'item',
      i.id,
      i.item_code,
      'related'
    FROM public.claims c
    JOIN public.items i ON i.id = c.item_id
    WHERE c.id = p_source_entity_id
      AND i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

    INSERT INTO public.note_entity_links (tenant_id, note_id, entity_type, entity_id, entity_number, link_kind)
    SELECT
      p_tenant_id,
      p_note_id,
      'item',
      i.id,
      i.item_code,
      'related'
    FROM public.claim_items ci
    JOIN public.items i ON i.id = ci.item_id
    WHERE ci.claim_id = p_source_entity_id
      AND i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;
  ELSIF p_source_entity_type = 'repair_quote' THEN
    INSERT INTO public.note_entity_links (tenant_id, note_id, entity_type, entity_id, entity_number, link_kind)
    SELECT
      p_tenant_id,
      p_note_id,
      'item',
      i.id,
      i.item_code,
      'related'
    FROM public.repair_quote_items rqi
    JOIN public.items i ON i.id = rqi.item_id
    WHERE rqi.repair_quote_id = p_source_entity_id
      AND i.tenant_id = p_tenant_id
      AND i.deleted_at IS NULL
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notes_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_parent public.notes%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.note := btrim(coalesce(NEW.note, ''));
    IF NEW.note = '' THEN
      RAISE EXCEPTION 'Note content cannot be empty';
    END IF;

    IF NEW.parent_note_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.notes WHERE id = NEW.parent_note_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent note not found';
      END IF;

      NEW.note_type := v_parent.note_type;
      NEW.visibility := v_parent.visibility;
      NEW.root_note_id := coalesce(v_parent.root_note_id, v_parent.id);
      NEW.source_entity_type := v_parent.source_entity_type;
      NEW.source_entity_id := v_parent.source_entity_id;
      NEW.source_entity_number := v_parent.source_entity_number;
    ELSE
      NEW.note_type := public.normalize_unified_note_type(NEW.note_type);
      NEW.visibility := CASE
        WHEN NEW.note_type IN ('public', 'exception') THEN 'public'
        ELSE 'internal'
      END;
      NEW.root_note_id := coalesce(NEW.root_note_id, NEW.id);
      IF NEW.source_entity_number IS NULL OR btrim(NEW.source_entity_number) = '' THEN
        NEW.source_entity_number := public.resolve_unified_entity_number(NEW.source_entity_type, NEW.source_entity_id);
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notes_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.parent_note_id IS NOT NULL THEN
    INSERT INTO public.note_entity_links (
      tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
    )
    SELECT
      NEW.tenant_id,
      NEW.id,
      nel.entity_type,
      nel.entity_id,
      nel.entity_number,
      nel.link_kind
    FROM public.note_entity_links nel
    WHERE nel.note_id = NEW.parent_note_id
    ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;
  ELSE
    PERFORM public.unified_note_attach_links(
      NEW.id,
      NEW.tenant_id,
      NEW.source_entity_type,
      NEW.source_entity_id,
      NEW.source_entity_number
    );
  END IF;

  INSERT INTO public.note_audit_log (
    tenant_id, note_id, action, actor_user_id, after_note, metadata
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    'created',
    NEW.created_by,
    NEW.note,
    jsonb_build_object(
      'note_type', NEW.note_type,
      'source_entity_type', NEW.source_entity_type,
      'source_entity_id', NEW.source_entity_id
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notes_after_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF coalesce(OLD.deleted_at::text, '') <> coalesce(NEW.deleted_at::text, '') AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.note_audit_log (
      tenant_id, note_id, action, actor_user_id, before_note, after_note, metadata
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      'deleted',
      coalesce(NEW.deleted_by, NEW.edited_by, NEW.created_by),
      OLD.note,
      NEW.note,
      jsonb_build_object('deleted_at', NEW.deleted_at)
    );
  ELSIF OLD.note IS DISTINCT FROM NEW.note THEN
    INSERT INTO public.note_audit_log (
      tenant_id, note_id, action, actor_user_id, before_note, after_note, metadata
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      'updated',
      coalesce(NEW.edited_by, NEW.created_by),
      OLD.note,
      NEW.note,
      jsonb_build_object('edited_at', coalesce(NEW.edited_at, now()))
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notes_before_write ON public.notes;
CREATE TRIGGER trg_notes_before_write
  BEFORE INSERT OR UPDATE
  ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notes_before_write();

DROP TRIGGER IF EXISTS trg_notes_after_insert ON public.notes;
CREATE TRIGGER trg_notes_after_insert
  AFTER INSERT
  ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notes_after_insert();

DROP TRIGGER IF EXISTS trg_notes_after_update ON public.notes;
CREATE TRIGGER trg_notes_after_update
  AFTER UPDATE
  ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notes_after_update();

CREATE OR REPLACE FUNCTION public.create_unified_note(
  p_entity_type text,
  p_entity_id uuid,
  p_note_text text,
  p_note_type text DEFAULT 'internal',
  p_parent_note_id uuid DEFAULT NULL,
  p_source_entity_number text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_note_id uuid;
  v_tenant_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tenant_id := public.user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Missing tenant context';
  END IF;

  INSERT INTO public.notes (
    tenant_id,
    note,
    note_type,
    parent_note_id,
    source_entity_type,
    source_entity_id,
    source_entity_number,
    metadata,
    created_by
  ) VALUES (
    v_tenant_id,
    p_note_text,
    public.normalize_unified_note_type(p_note_type),
    p_parent_note_id,
    p_entity_type,
    p_entity_id,
    p_source_entity_number,
    coalesce(p_metadata, '{}'::jsonb),
    v_actor_id
  )
  RETURNING id INTO v_note_id;

  IF p_parent_note_id IS NOT NULL THEN
    UPDATE public.notes
    SET updated_at = now()
    WHERE id = p_parent_note_id;
  END IF;

  RETURN v_note_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_unified_note(
  p_note_id uuid,
  p_note_text text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.unified_note_can_manage(p_note_id, v_actor) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.notes
  SET
    note = btrim(coalesce(p_note_text, '')),
    edited_by = v_actor,
    edited_at = now()
  WHERE id = p_note_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_unified_note(
  p_note_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.unified_note_can_manage(p_note_id, v_actor) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.notes
  SET
    deleted_at = now(),
    deleted_by = v_actor
  WHERE id = p_note_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_unified_note(text, uuid, text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_unified_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_unified_note(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unified_note_can_manage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_unified_entity_number(text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Backfill canonical notes from legacy note tables
-- -----------------------------------------------------------------------------

-- Shipment notes table -> notes
INSERT INTO public.notes (
  id,
  tenant_id,
  note,
  note_type,
  visibility,
  parent_note_id,
  source_entity_type,
  source_entity_id,
  source_entity_number,
  metadata,
  created_by,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  sn.id,
  coalesce(sn.tenant_id, s.tenant_id),
  sn.note,
  public.normalize_unified_note_type(sn.note_type),
  CASE WHEN public.normalize_unified_note_type(sn.note_type) IN ('public', 'exception') THEN 'public' ELSE 'internal' END,
  sn.parent_note_id,
  'shipment',
  sn.shipment_id,
  s.shipment_number,
  jsonb_strip_nulls(
    jsonb_build_object(
      'legacy_table', 'shipment_notes',
      'legacy_exception_code', sn.exception_code,
      'legacy_is_chip_generated', coalesce(sn.is_chip_generated, false)
    )
  ),
  sn.created_by,
  sn.deleted_at,
  coalesce(sn.created_at, now()),
  coalesce(sn.updated_at, sn.created_at, now())
FROM public.shipment_notes sn
JOIN public.shipments s ON s.id = sn.shipment_id
WHERE sn.shipment_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Item notes table -> notes
INSERT INTO public.notes (
  id,
  tenant_id,
  note,
  note_type,
  visibility,
  parent_note_id,
  source_entity_type,
  source_entity_id,
  source_entity_number,
  metadata,
  created_by,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  inote.id,
  coalesce(inote.tenant_id, i.tenant_id),
  inote.note,
  public.normalize_unified_note_type(inote.note_type),
  CASE WHEN public.normalize_unified_note_type(inote.note_type) IN ('public', 'exception') THEN 'public' ELSE 'internal' END,
  inote.parent_note_id,
  'item',
  inote.item_id,
  i.item_code,
  jsonb_strip_nulls(
    jsonb_build_object(
      'legacy_table', 'item_notes',
      'legacy_version', inote.version,
      'legacy_is_current', inote.is_current
    )
  ),
  inote.created_by,
  inote.deleted_at,
  coalesce(inote.created_at, now()),
  coalesce(inote.updated_at, inote.created_at, now())
FROM public.item_notes inote
JOIN public.items i ON i.id = inote.item_id
WHERE inote.item_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Task notes table -> notes
INSERT INTO public.notes (
  id,
  tenant_id,
  note,
  note_type,
  visibility,
  parent_note_id,
  source_entity_type,
  source_entity_id,
  source_entity_number,
  metadata,
  created_by,
  created_at,
  updated_at
)
SELECT
  tn.id,
  coalesce(tn.tenant_id, t.tenant_id),
  tn.note,
  public.normalize_unified_note_type(tn.note_type),
  CASE WHEN public.normalize_unified_note_type(tn.note_type) IN ('public', 'exception') THEN 'public' ELSE 'internal' END,
  tn.parent_note_id,
  'task',
  tn.task_id,
  public.resolve_unified_entity_number('task', tn.task_id),
  jsonb_strip_nulls(
    jsonb_build_object(
      'legacy_table', 'task_notes',
      'legacy_is_required', tn.is_required
    )
  ),
  tn.created_by,
  coalesce(tn.created_at, now()),
  coalesce(tn.created_at, now())
FROM public.task_notes tn
JOIN public.tasks t ON t.id = tn.task_id
WHERE tn.task_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Legacy single-field/inline notes -> canonical notes
-- Decision: migrate legacy single-field notes as INTERNAL by default.

-- shipments.notes
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  s.tenant_id,
  btrim(s.notes),
  'internal',
  'internal',
  'shipment',
  s.id,
  s.shipment_number,
  '{"legacy_field":"shipments.notes"}'::jsonb,
  now(),
  now()
FROM public.shipments s
WHERE s.notes IS NOT NULL
  AND btrim(s.notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'shipment'
      AND n.source_entity_id = s.id
      AND (n.metadata ->> 'legacy_field') = 'shipments.notes'
  );

-- shipments.receiving_notes
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  s.tenant_id,
  btrim(s.receiving_notes),
  'internal',
  'internal',
  'shipment',
  s.id,
  s.shipment_number,
  '{"legacy_field":"shipments.receiving_notes"}'::jsonb,
  now(),
  now()
FROM public.shipments s
WHERE s.receiving_notes IS NOT NULL
  AND btrim(s.receiving_notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'shipment'
      AND n.source_entity_id = s.id
      AND (n.metadata ->> 'legacy_field') = 'shipments.receiving_notes'
  );

-- tasks.task_notes (legacy internal)
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  t.tenant_id,
  btrim(t.task_notes),
  'internal',
  'internal',
  'task',
  t.id,
  public.resolve_unified_entity_number('task', t.id),
  '{"legacy_field":"tasks.task_notes"}'::jsonb,
  now(),
  now()
FROM public.tasks t
WHERE t.task_notes IS NOT NULL
  AND btrim(t.task_notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'task'
      AND n.source_entity_id = t.id
      AND (n.metadata ->> 'legacy_field') = 'tasks.task_notes'
  );

-- claims.resolution_notes (legacy internal)
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  c.tenant_id,
  btrim(c.resolution_notes),
  'internal',
  'internal',
  'claim',
  c.id,
  c.claim_number,
  '{"legacy_field":"claims.resolution_notes"}'::jsonb,
  now(),
  now()
FROM public.claims c
WHERE c.resolution_notes IS NOT NULL
  AND btrim(c.resolution_notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'claim'
      AND n.source_entity_id = c.id
      AND (n.metadata ->> 'legacy_field') = 'claims.resolution_notes'
  );

-- quotes.internal_notes (internal)
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  q.tenant_id,
  btrim(q.internal_notes),
  'internal',
  'internal',
  'quote',
  q.id,
  q.quote_number,
  '{"legacy_field":"quotes.internal_notes"}'::jsonb,
  now(),
  now()
FROM public.quotes q
WHERE q.internal_notes IS NOT NULL
  AND btrim(q.internal_notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'quote'
      AND n.source_entity_id = q.id
      AND (n.metadata ->> 'legacy_field') = 'quotes.internal_notes'
  );

-- quotes.notes (public field historically)
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  q.tenant_id,
  btrim(q.notes),
  'public',
  'public',
  'quote',
  q.id,
  q.quote_number,
  '{"legacy_field":"quotes.notes"}'::jsonb,
  now(),
  now()
FROM public.quotes q
WHERE q.notes IS NOT NULL
  AND btrim(q.notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'quote'
      AND n.source_entity_id = q.id
      AND (n.metadata ->> 'legacy_field') = 'quotes.notes'
  );

-- stocktakes.notes
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  st.tenant_id,
  btrim(st.notes),
  'internal',
  'internal',
  'stocktake',
  st.id,
  st.stocktake_number,
  '{"legacy_field":"stocktakes.notes"}'::jsonb,
  now(),
  now()
FROM public.stocktakes st
WHERE st.notes IS NOT NULL
  AND btrim(st.notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'stocktake'
      AND n.source_entity_id = st.id
      AND (n.metadata ->> 'legacy_field') = 'stocktakes.notes'
  );

-- repair_quotes.notes
INSERT INTO public.notes (
  tenant_id, note, note_type, visibility, source_entity_type, source_entity_id, source_entity_number,
  metadata, created_at, updated_at
)
SELECT
  rq.tenant_id,
  btrim(rq.notes),
  'internal',
  'internal',
  'repair_quote',
  rq.id,
  coalesce('RPQ-' || substring(rq.id::text, 1, 8), rq.id::text),
  '{"legacy_field":"repair_quotes.notes"}'::jsonb,
  now(),
  now()
FROM public.repair_quotes rq
WHERE rq.notes IS NOT NULL
  AND btrim(rq.notes) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.source_entity_type = 'repair_quote'
      AND n.source_entity_id = rq.id
      AND (n.metadata ->> 'legacy_field') = 'repair_quotes.notes'
  );

-- Compute canonical thread roots across all imported notes.
WITH RECURSIVE note_tree AS (
  SELECT
    n.id,
    n.parent_note_id,
    n.id AS root_id
  FROM public.notes n
  WHERE n.parent_note_id IS NULL

  UNION ALL

  SELECT
    c.id,
    c.parent_note_id,
    nt.root_id
  FROM public.notes c
  JOIN note_tree nt ON c.parent_note_id = nt.id
)
UPDATE public.notes n
SET root_note_id = nt.root_id
FROM note_tree nt
WHERE n.id = nt.id
  AND n.root_note_id IS DISTINCT FROM nt.root_id;

-- Ensure standalone rows still have a root
UPDATE public.notes
SET root_note_id = id
WHERE root_note_id IS NULL;

-- Source links for every note row (idempotent via unique)
INSERT INTO public.note_entity_links (
  tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
)
SELECT
  n.tenant_id,
  n.id,
  n.source_entity_type,
  n.source_entity_id,
  n.source_entity_number,
  'source'
FROM public.notes n
WHERE n.source_entity_type IS NOT NULL
  AND n.source_entity_id IS NOT NULL
ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

-- Related item links for shipment and task notes (legacy + canonical)
INSERT INTO public.note_entity_links (
  tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
)
SELECT
  n.tenant_id,
  n.id,
  'item',
  i.id,
  i.item_code,
  'related'
FROM public.notes n
JOIN public.items i
  ON i.tenant_id = n.tenant_id
 AND i.receiving_shipment_id = n.source_entity_id
WHERE n.source_entity_type = 'shipment'
  AND i.deleted_at IS NULL
ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

INSERT INTO public.note_entity_links (
  tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
)
SELECT
  n.tenant_id,
  n.id,
  'item',
  i.id,
  i.item_code,
  'related'
FROM public.notes n
JOIN public.task_items ti
  ON ti.task_id = n.source_entity_id
JOIN public.items i
  ON i.id = ti.item_id
 AND i.tenant_id = n.tenant_id
WHERE n.source_entity_type = 'task'
  AND i.deleted_at IS NULL
ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

-- Claim related items
INSERT INTO public.note_entity_links (
  tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
)
SELECT
  n.tenant_id,
  n.id,
  'item',
  i.id,
  i.item_code,
  'related'
FROM public.notes n
JOIN public.claim_items ci
  ON ci.claim_id = n.source_entity_id
JOIN public.items i
  ON i.id = ci.item_id
 AND i.tenant_id = n.tenant_id
WHERE n.source_entity_type = 'claim'
  AND i.deleted_at IS NULL
ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

-- Repair quote related items
INSERT INTO public.note_entity_links (
  tenant_id, note_id, entity_type, entity_id, entity_number, link_kind
)
SELECT
  n.tenant_id,
  n.id,
  'item',
  i.id,
  i.item_code,
  'related'
FROM public.notes n
JOIN public.repair_quote_items rqi
  ON rqi.repair_quote_id = n.source_entity_id
JOIN public.items i
  ON i.id = rqi.item_id
 AND i.tenant_id = n.tenant_id
WHERE n.source_entity_type = 'repair_quote'
  AND i.deleted_at IS NULL
ON CONFLICT (note_id, entity_type, entity_id, link_kind) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Legacy compatibility sync: shipment_notes -> notes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_shipment_notes_to_unified_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shipment_number text;
  v_tenant_id uuid;
  v_note_type text;
  v_visibility text;
  v_metadata jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.notes
    SET deleted_at = coalesce(deleted_at, now())
    WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT s.tenant_id, s.shipment_number
  INTO v_tenant_id, v_shipment_number
  FROM public.shipments s
  WHERE s.id = NEW.shipment_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_note_type := public.normalize_unified_note_type(NEW.note_type);
  v_visibility := CASE
    WHEN v_note_type IN ('public', 'exception') THEN 'public'
    ELSE 'internal'
  END;
  v_metadata := jsonb_strip_nulls(
    jsonb_build_object(
      'legacy_table', 'shipment_notes',
      'legacy_exception_code', NEW.exception_code,
      'legacy_is_chip_generated', coalesce(NEW.is_chip_generated, false)
    )
  );

  INSERT INTO public.notes (
    id,
    tenant_id,
    note,
    note_type,
    visibility,
    parent_note_id,
    root_note_id,
    source_entity_type,
    source_entity_id,
    source_entity_number,
    metadata,
    created_by,
    deleted_at,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    coalesce(NEW.tenant_id, v_tenant_id),
    NEW.note,
    v_note_type,
    v_visibility,
    NEW.parent_note_id,
    NULL,
    'shipment',
    NEW.shipment_id,
    v_shipment_number,
    v_metadata,
    NEW.created_by,
    NEW.deleted_at,
    coalesce(NEW.created_at, now()),
    coalesce(NEW.updated_at, NEW.created_at, now())
  )
  ON CONFLICT (id) DO UPDATE
  SET
    note = EXCLUDED.note,
    note_type = EXCLUDED.note_type,
    visibility = EXCLUDED.visibility,
    parent_note_id = EXCLUDED.parent_note_id,
    source_entity_type = EXCLUDED.source_entity_type,
    source_entity_id = EXCLUDED.source_entity_id,
    source_entity_number = EXCLUDED.source_entity_number,
    metadata = EXCLUDED.metadata,
    created_by = coalesce(public.notes.created_by, EXCLUDED.created_by),
    deleted_at = EXCLUDED.deleted_at,
    updated_at = EXCLUDED.updated_at;

  -- Ensure root relationship is refreshed after upsert.
  UPDATE public.notes n
  SET root_note_id = coalesce(p.root_note_id, p.id, n.id)
  FROM public.notes p
  WHERE n.id = NEW.id
    AND n.parent_note_id = p.id;

  UPDATE public.notes
  SET root_note_id = id
  WHERE id = NEW.id
    AND root_note_id IS NULL;

  PERFORM public.unified_note_attach_links(
    NEW.id,
    coalesce(NEW.tenant_id, v_tenant_id),
    'shipment',
    NEW.shipment_id,
    v_shipment_number
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_shipment_notes_to_unified ON public.shipment_notes;
CREATE TRIGGER trg_sync_shipment_notes_to_unified
  AFTER INSERT OR UPDATE OR DELETE
  ON public.shipment_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_shipment_notes_to_unified_notes();

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can select notes in tenant" ON public.notes;
CREATE POLICY "Staff can select notes in tenant"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can insert notes in tenant" ON public.notes;
CREATE POLICY "Staff can insert notes in tenant"
  ON public.notes FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can update manageable notes in tenant" ON public.notes;
CREATE POLICY "Staff can update manageable notes in tenant"
  ON public.notes FOR UPDATE
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND public.unified_note_can_manage(id, auth.uid())
  )
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can delete manageable notes in tenant" ON public.notes;
CREATE POLICY "Staff can delete manageable notes in tenant"
  ON public.notes FOR DELETE
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND public.unified_note_can_manage(id, auth.uid())
  );

DROP POLICY IF EXISTS "Client users can read public notes in their account context" ON public.notes;
CREATE POLICY "Client users can read public notes in their account context"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND visibility = 'public'
    AND EXISTS (
      SELECT 1
      FROM public.note_entity_links nel
      LEFT JOIN public.shipments s
        ON nel.entity_type = 'shipment' AND s.id = nel.entity_id
      LEFT JOIN public.items i
        ON nel.entity_type = 'item' AND i.id = nel.entity_id
      LEFT JOIN public.tasks t
        ON nel.entity_type = 'task' AND t.id = nel.entity_id
      LEFT JOIN public.claims c
        ON nel.entity_type = 'claim' AND c.id = nel.entity_id
      LEFT JOIN public.quotes q
        ON nel.entity_type = 'quote' AND q.id = nel.entity_id
      LEFT JOIN public.repair_quotes rq
        ON nel.entity_type = 'repair_quote' AND rq.id = nel.entity_id
      WHERE nel.note_id = notes.id
        AND (
          (nel.entity_type = 'shipment' AND s.tenant_id = public.user_tenant_id() AND s.account_id = public.client_portal_account_id())
          OR (nel.entity_type = 'item' AND i.tenant_id = public.user_tenant_id() AND i.account_id = public.client_portal_account_id())
          OR (nel.entity_type = 'task' AND t.tenant_id = public.user_tenant_id() AND t.account_id = public.client_portal_account_id())
          OR (nel.entity_type = 'claim' AND c.tenant_id = public.user_tenant_id() AND c.account_id = public.client_portal_account_id())
          OR (nel.entity_type = 'quote' AND q.tenant_id = public.user_tenant_id() AND q.account_id = public.client_portal_account_id())
          OR (nel.entity_type = 'repair_quote' AND rq.tenant_id = public.user_tenant_id() AND rq.account_id = public.client_portal_account_id())
        )
    )
  );

DROP POLICY IF EXISTS "Staff can select note links in tenant" ON public.note_entity_links;
CREATE POLICY "Staff can select note links in tenant"
  ON public.note_entity_links FOR SELECT
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can manage note links in tenant" ON public.note_entity_links;
CREATE POLICY "Staff can manage note links in tenant"
  ON public.note_entity_links FOR ALL
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Client users can read visible note links in account context" ON public.note_entity_links;
CREATE POLICY "Client users can read visible note links in account context"
  ON public.note_entity_links FOR SELECT
  TO authenticated
  USING (
    public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.notes n
      WHERE n.id = note_entity_links.note_id
        AND n.visibility = 'public'
        AND n.tenant_id = public.user_tenant_id()
    )
    AND (
      (entity_type = 'shipment' AND EXISTS (
        SELECT 1 FROM public.shipments s
        WHERE s.id = entity_id
          AND s.tenant_id = public.user_tenant_id()
          AND s.account_id = public.client_portal_account_id()
      ))
      OR (entity_type = 'item' AND EXISTS (
        SELECT 1 FROM public.items i
        WHERE i.id = entity_id
          AND i.tenant_id = public.user_tenant_id()
          AND i.account_id = public.client_portal_account_id()
      ))
      OR (entity_type = 'task' AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = entity_id
          AND t.tenant_id = public.user_tenant_id()
          AND t.account_id = public.client_portal_account_id()
      ))
      OR (entity_type = 'claim' AND EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.id = entity_id
          AND c.tenant_id = public.user_tenant_id()
          AND c.account_id = public.client_portal_account_id()
      ))
      OR (entity_type = 'quote' AND EXISTS (
        SELECT 1 FROM public.quotes q
        WHERE q.id = entity_id
          AND q.tenant_id = public.user_tenant_id()
          AND q.account_id = public.client_portal_account_id()
      ))
      OR (entity_type = 'repair_quote' AND EXISTS (
        SELECT 1 FROM public.repair_quotes rq
        WHERE rq.id = entity_id
          AND rq.tenant_id = public.user_tenant_id()
          AND rq.account_id = public.client_portal_account_id()
      ))
    )
  );

DROP POLICY IF EXISTS "Staff can read note mentions in tenant" ON public.note_mentions;
CREATE POLICY "Staff can read note mentions in tenant"
  ON public.note_mentions FOR SELECT
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can insert note mentions in tenant" ON public.note_mentions;
CREATE POLICY "Staff can insert note mentions in tenant"
  ON public.note_mentions FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can read note audit in tenant" ON public.note_audit_log;
CREATE POLICY "Staff can read note audit in tenant"
  ON public.note_audit_log FOR SELECT
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "System can insert note audit in tenant" ON public.note_audit_log;
CREATE POLICY "System can insert note audit in tenant"
  ON public.note_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.user_tenant_id());

GRANT ALL ON TABLE public.notes TO authenticated;
GRANT ALL ON TABLE public.note_entity_links TO authenticated;
GRANT ALL ON TABLE public.note_mentions TO authenticated;
GRANT ALL ON TABLE public.note_audit_log TO authenticated;

