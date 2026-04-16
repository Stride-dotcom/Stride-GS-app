# Locked Decision Source — Dock Intake Matching Candidates Expand + Item Preview
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> When creating the dock intake the matching candidates options needs to drop down to expand to see the list of items ( qty, vendor, description, sidemark, room ) so the user can confirm if this is a match. and from that list they should be able to select multiple rows to link in case only some match, or link the whole shipment if all match.

## Baseline observation

- Dock Intake matching panel showed candidate shipments with confidence + a single “Link” button per row.
- There was no way to inspect a candidate shipment’s line items without navigating away.
- There was no bulk “link selected” workflow.

## Decision summary

- Candidate rows in Dock Intake matching panel must be expandable to show the candidate shipment’s line items (qty, vendor, description, sidemark, room) so the user can verify a match inline.
- Provide a bulk “Link Selected” action for selecting multiple candidate shipments to link to the dock intake in one step (while preserving the existing per-row “Link” action).

## Implementation references

- `src/components/incoming/DockIntakeMatchingPanel.tsx`
  - Candidate rows converted to collapsible/expandable rows with an “Items” preview.
  - Added selection checkboxes and a “Link Selected” bulk action.

