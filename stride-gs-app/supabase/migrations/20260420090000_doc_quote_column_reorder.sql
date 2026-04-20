-- Session 74: reorder Services table columns on the DOC_QUOTE template
-- to match the approved sample Quote_EST-00018.pdf:
--   Service | Class | Rate | Qty | Total   (Rate BEFORE Qty)
-- was previously:
--   Service | Class | Qty | Rate | Total
-- Idempotent: replace() is a no-op if the header block was already
-- reordered.
UPDATE public.email_templates
SET body = replace(body,
  '<th style="width:45%">Service</th>
        <th style="width:20%">Class</th>
        <th class="num" style="width:10%">Qty</th>
        <th class="num" style="width:12%">Rate</th>
        <th class="num" style="width:13%">Total</th>',
  '<th style="width:40%">Service</th>
        <th style="width:15%">Class</th>
        <th class="num" style="width:15%">Rate</th>
        <th class="num" style="width:12%">Qty</th>
        <th class="num" style="width:18%">Total</th>'
)
WHERE template_key = 'DOC_QUOTE';
