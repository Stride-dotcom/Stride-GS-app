-- dt_statuses: replace the Phase-1a inferred seed (15 rows) with DispatchTrack's
-- actual canonical status vocabulary from the XML API.
--
-- Source of truth: DispatchTrackXMLDataAPI_V8.1.pdf page 8 —
--     <status>{New, Scheduled, Started, Unable to Start, Finished, Unable to Finish}</status>
--
-- The old seed was built from webhook-tag guesses (Entered, In Transit, On
-- Delivery, Arrived, etc.) and none of those strings appear in the DT API.
-- Replacing now, before Phase 1c webhook ingest goes live, means every future
-- order lands with a label that matches exactly what DT's dispatch UI shows.
--
-- Strategy:
--   1. Null every dt_orders.status_id / substatus_id so we can rewrite the FK target.
--   2. Delete the old substatus + status rows.
--   3. Insert the six canonical statuses. IDs 0–5 chosen to leave room for
--      additional DT sub-states if they appear later.
--   4. Phase 1c webhook ingest will re-populate status_id from DT's `status`
--      field string → code lookup, so the NULL values are transient.

UPDATE public.dt_orders
   SET status_id = NULL, substatus_id = NULL
 WHERE status_id IS NOT NULL OR substatus_id IS NOT NULL;

DELETE FROM public.dt_substatuses;
DELETE FROM public.dt_statuses;

INSERT INTO public.dt_statuses (id, code, name, category, display_order, color) VALUES
  (0, 'new',              'New',              'open',        0, '#94a3b8'),
  (1, 'scheduled',        'Scheduled',        'open',        1, '#8b5cf6'),
  (2, 'started',          'Started',          'in_progress', 2, '#3b82f6'),
  (3, 'finished',         'Finished',         'completed',   3, '#22c55e'),
  (4, 'unable_to_start',  'Unable to Start',  'exception',   4, '#f59e0b'),
  (5, 'unable_to_finish', 'Unable to Finish', 'exception',   5, '#ef4444');

-- Note: delivery outcome rollups (Delivered / Not Delivered / Partial Delivery)
-- lived at ids 100–102 in the old seed. In the canonical DT model the outcome
-- is carried at the ITEM level via <delivered>{true|false}</delivered> on each
-- <item>, not at the order level. Order-level status is always one of the six
-- above. Outcome summaries (all delivered / some delivered / none) are derived
-- in the UI from the sum of item-level delivered flags, not stored here.
