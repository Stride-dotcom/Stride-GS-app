# Locked Decision Source — Expected/Manifest Create: Legacy Form Parity
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> The create expected shipment page was supposed to mirror or be copy and pasted from the legacy incoming shipment. We spent a lot of time building that out exactly how we planned to use it and it was not brought over. We need to copy and paste it’s layout and functionality including the item entry, duplicate buttons, default shipment notes field, etc.

## Baseline observation

- Incoming → Expected/Manifest creation was a quick-create insert flow (plus an account-selection dialog), not the legacy full create form experience.
- A legacy-style full create form already existed (`ShipmentCreate`) with item entry + duplicate actions, but it was not used from the Incoming console.

## Decision summary

- Incoming → “New Expected Shipment” must route to the legacy-style full create form.
- Incoming → “New Manifest” should use the same full create form with `inbound_kind='manifest'`.
- The create form must support account default shipment notes prefill/highlighting (legacy parity).
- On successful creation from Incoming, redirect into the Incoming detail pages:
  - Expected → `/incoming/expected/:id`
  - Manifest → `/incoming/manifest/:id`

## Implementation references

- `src/components/shipments/IncomingContent.tsx`
  - “New Manifest” → `/incoming/manifest/new`
  - “New Expected Shipment” → `/incoming/expected/new`
- `src/App.tsx`
  - Added routes `/incoming/manifest/new` and `/incoming/expected/new` → `ShipmentCreate`
- `src/pages/ShipmentCreate.tsx`
  - Detects inbound kind (expected vs manifest) from route.
  - Inserts with correct `inbound_kind` to ensure MAN-/EXP- prefix generation.
  - Prefills notes from `accounts.default_shipment_notes` + highlight flag.
  - Redirects to Incoming detail pages when created from `/incoming/*`.

