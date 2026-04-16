# Locked Decision Source — Dock Intake Stage 1: Default Shipment Notes Prefill
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> Dock intake stage 1 needs the default shipment notes field that pulls the default shipment notes from the client account settings - preferences page Just like the legacy incoming shipment form did.

## Baseline observation

- Dock Intake Stage 1 had a Notes field, but it did not prefill from the selected account’s `default_shipment_notes`.
- The Shipment Detail page already fetches and highlights these account-level default notes.

## Decision summary

- When an account is selected on Dock Intake Stage 1, fetch `accounts.default_shipment_notes` (+ `highlight_shipment_notes`).
- If the shipment notes are blank and the user hasn’t edited them, prefill the Notes field and autosave it to the shipment.
- If `highlight_shipment_notes` is enabled, show a visible callout to ensure operators notice the default notes.

## Implementation references

- `src/components/receiving/Stage1DockIntake.tsx`
  - Loads account default notes on account selection.
  - Prefills notes once (unless user edits).
  - Displays highlight callout when enabled.

