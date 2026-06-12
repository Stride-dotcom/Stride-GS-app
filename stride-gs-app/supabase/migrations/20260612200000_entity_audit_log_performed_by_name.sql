-- entity_audit_log.performed_by_name — human display name alongside the
-- performed_by email, so the ActivityTimeline shows "by Justin" instead of
-- the email local-part when a display name is known.
--
-- Nullable + additive: every existing writer keeps working unchanged; the
-- browser-side logEntityAudit helper populates it from the authed user's
-- displayName. No RLS / grant changes needed (column rides the existing
-- table policies).

ALTER TABLE public.entity_audit_log
  ADD COLUMN IF NOT EXISTS performed_by_name text;
