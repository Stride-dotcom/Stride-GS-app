# Locked Decision Source — Intake Repairs List (Dock Intake Stage 1/2 + Exceptions + Counts + Scanner)
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

1. when you complete stage 1 dock intake stage 2 should be on the same page and the stage 2 section now expands down to expose stage 2 fields. This will allow adding more photos and documents during stage 2 if needed. There is already a page for intake in progress which is how this combined stage 1&2 should look / function.

2. When a signature is added ( drawn or typed ) this should be viewed in the signature field. And the capture button should change to edit since it’s already been captured.

3. The exception buttons do not add or save exceptions including the “other” option which requires a note. The note won’t save.

4. On stage 2 page there is a field for received pieces. This needs to be moved to the shipment summary section. And basically what we should have is three fields for peace counts:
   - first field is how many pieces the carrier paperwork says (what you sign for)
   - second one is how many pieces you actually received at dock intake stage one
   - final count auto calculated by the number of rows of items you enter (one item code per row) and renamed to “entered pieces”
   - mismatches should prompt/flag and require an exception note

5. Add mis-ship as an exception chip making sure the button works and creates the exception indicator and any updates etc.

6. Can we fix the document camera to actually scan to black and white pdf? We would have to install some kind of scanner in the app and not rely on the device to convert the images.

## Clarifications captured (so far)

### Item 1: Combined Stage 1 & Stage 2
- Access path: **Shipments Hub → expand “Intakes in Progress” card → click an intake**.
- The list shows status as “Expected”; user expectation is “In Progress”.
- Status display should reflect the *actual dock intake stage* (draft / stage1_complete / receiving), but must be a **safe UI-only mapping** (do not introduce new workflow states).
- UX: **“Continue to Stage 2”** button starts Stage 2.
- Stage 1 should remain **editable**.
- Stage 2 photos/documents should use the **same buckets/collections** as Stage 1.
- “Confirm Dock Intake” can render **inline as a reminder**, but must **not block** proceeding.
- Page should resemble the “intake in progress” view reached from the Hub workflow above.

## Open questions / unresolved decisions

- What exact status label(s) should the Hub “Intakes in Progress” card display for dock intakes:
  - mapped labels derived from `inbound_status` (`draft`, `stage1_complete`, `receiving`), with an “In Progress” fallback if unknown?
  - Confirm the human-readable label text for `stage1_complete` (e.g. “Stage 1 Complete” vs “Ready for Stage 2”).

## Notes

- No repairs implemented in this source artifact; this is a tracking artifact to ensure the full intake repairs list is executed and validated end-to-end.

