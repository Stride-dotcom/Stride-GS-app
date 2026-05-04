-- Audit table for the new stax-webhook edge function. Every Stax webhook
-- POST gets a row here BEFORE any business logic runs, so we have a
-- re-runnable record of every event Stax has ever sent us — even ones
-- with unknown event types or unresolvable invoice IDs.
--
-- event_id is unique (Stax sends a stable id per event); the upsert in
-- the edge function uses it as the conflict target so retries are no-ops.
-- Idempotency at the table level means the function's own re-entry
-- handling is also defensive.

CREATE TABLE IF NOT EXISTS public.stax_webhook_events (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text           UNIQUE NOT NULL,
  event_type    text,
  payload       jsonb          NOT NULL,
  received_at   timestamptz    NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  processing_error text
);

CREATE INDEX IF NOT EXISTS stax_webhook_events_event_type_idx ON public.stax_webhook_events (event_type);
CREATE INDEX IF NOT EXISTS stax_webhook_events_received_at_idx ON public.stax_webhook_events (received_at DESC);

-- Service role only — webhook function runs as service role, no client
-- access needed (no React UI surface yet; admin can query directly via
-- the Supabase dashboard).
ALTER TABLE public.stax_webhook_events ENABLE ROW LEVEL SECURITY;

-- Confirm 'Paid' is a recognized status on public.billing. The CHECK
-- constraint (if any) needs to allow it; otherwise the webhook's
-- billing flip will fail. We intentionally don't add a constraint here
-- since billing.status is currently un-constrained text — but if
-- someone later adds a CHECK they need to include 'Paid'.
COMMENT ON TABLE public.stax_webhook_events IS
  'Raw audit log of Stax webhook events received by the stax-webhook edge function. Every POST is upserted here before business logic — losing this row is fatal to the audit trail. Keys: event_id (stax-side id), event_type (e.g. invoice.paid), payload (full body).';
