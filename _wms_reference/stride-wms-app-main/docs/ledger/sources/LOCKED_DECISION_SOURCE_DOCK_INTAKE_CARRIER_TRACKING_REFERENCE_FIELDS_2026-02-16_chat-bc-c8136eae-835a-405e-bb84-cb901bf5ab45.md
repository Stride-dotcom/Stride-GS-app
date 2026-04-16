# Locked Decision Source — Dock Intake Carrier / Tracking / Reference Fields
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> There are no fields to enter carrier name, tracking, reference.

## Baseline observation

- Dock Intake Stage 1 form captured account/vendor/signed pieces but did not provide inputs for carrier, tracking number, or a reference/PO value.

## Decision summary

- Dock Intake Stage 1 must include fields for:
  - Carrier name
  - Tracking number
  - Reference / PO number
- These should autosave onto the dock-intake shipment record for visibility and downstream search.

## Implementation references

- `src/components/receiving/Stage1DockIntake.tsx`
  - Added Carrier Name, Tracking #, and Reference/PO # inputs.
  - Autosaves to `shipments.carrier`, `shipments.tracking_number`, `shipments.po_number`.

