-- Atomic quote number reservation.
--
-- Background: nextQuoteNumber lived in per-user localStorage
-- (`stride_quotes_{email}_settings`), so each user — and each device
-- per user — maintained an independent counter. Justin and Ken both
-- generated EST-1000; Justin generated EST-1001 from two devices.
-- Result: duplicate quote numbers in the visible list.
--
-- Fix: a single counter row per prefix in `quote_counters`, mutated
-- atomically by `reserve_quote_number(prefix)`. The frontend calls
-- this RPC every time it needs a new number; localStorage is no
-- longer authoritative.

CREATE TABLE IF NOT EXISTS public.quote_counters (
  prefix     text PRIMARY KEY,
  last_used  integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_counters ENABLE ROW LEVEL SECURITY;

-- Seed each existing prefix to MAX(existing quote_number) so the next
-- reserved value cannot collide with a number already on a saved quote.
-- Also handles the case where no quotes exist yet (empty insert).
INSERT INTO public.quote_counters (prefix, last_used)
SELECT
  split_part(quote_number, '-', 1) AS prefix,
  COALESCE(MAX(NULLIF(split_part(quote_number, '-', 2), '')::integer), 999) AS last_used
FROM public.quotes
WHERE quote_number IS NOT NULL
  AND quote_number ~ '^[A-Z]+-[0-9]+$'
GROUP BY split_part(quote_number, '-', 1)
ON CONFLICT (prefix) DO UPDATE
  SET last_used = GREATEST(quote_counters.last_used, EXCLUDED.last_used),
      updated_at = now();

-- Default seed for the standard EST prefix in case the table is empty
-- (no quotes yet → INSERT…SELECT above produced zero rows).
INSERT INTO public.quote_counters (prefix, last_used)
VALUES ('EST', 999)
ON CONFLICT (prefix) DO NOTHING;

-- ── reserve_quote_number(prefix) ────────────────────────────────────
-- Atomically increments the counter and returns the new value. The
-- INSERT…ON CONFLICT DO UPDATE pattern takes a row lock for the
-- duration of the statement, so concurrent calls cannot both see the
-- same last_used.
--
-- Returns the new (post-increment) integer. Caller formats it as
-- `${prefix}-${String(n).padStart(4, '0')}`.
--
-- SECURITY DEFINER + SET search_path keeps the function behavior
-- independent of the caller's search_path, which is required for
-- RPC calls from the JS client.
CREATE OR REPLACE FUNCTION public.reserve_quote_number(p_prefix text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF p_prefix IS NULL OR p_prefix = '' THEN
    RAISE EXCEPTION 'prefix required';
  END IF;

  INSERT INTO public.quote_counters AS qc (prefix, last_used, updated_at)
  VALUES (p_prefix, 1000, now())
  ON CONFLICT (prefix) DO UPDATE
    SET last_used  = qc.last_used + 1,
        updated_at = now()
  RETURNING qc.last_used INTO v_next;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_quote_number(text) TO authenticated;
