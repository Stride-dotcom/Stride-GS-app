# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-expected-manifest-create-legacy-form-parity-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Expected/Manifest creation legacy-form parity
- Topic Slug: `EXPECTED_MANIFEST_CREATE_LEGACY_FORM_PARITY`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_EXPECTED_MANIFEST_CREATE_LEGACY_FORM_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-010`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-010 | Expected/Manifest create uses legacy full form, applies account default notes, and redirects to Incoming detail | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_EXPECTED_MANIFEST_CREATE_LEGACY_FORM_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-010: Expected/Manifest create uses legacy full form, applies account default notes, and redirects to Incoming detail
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_EXPECTED_MANIFEST_CREATE_LEGACY_FORM_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Incoming Expected Shipment / Manifest creation must use the legacy-style full create form (item entry + duplicate controls), must apply account default shipment notes, and must redirect back into Incoming detail views after creation when initiated from `/incoming/*`.

#### Why
The quick-create flow regressed critical legacy functionality. Restoring full-form parity preserves the operator workflow and reduces intake errors.

#### Implementation impact
- UI: `src/components/shipments/IncomingContent.tsx` route “New Expected Shipment” / “New Manifest” to dedicated create routes.
- UI/Logic: `src/pages/ShipmentCreate.tsx` support expected vs manifest inbound_kind, prefill notes from account defaults, and redirect into incoming detail when created from `/incoming/*`.
- Routing: `src/App.tsx` add `/incoming/expected/new` and `/incoming/manifest/new` routes.

## Implementation Log Rows

| DLE-2026-02-16-015 | 2026-02-16 | DL-2026-02-16-010 | completed | `src/components/shipments/IncomingContent.tsx` | builder | “New Expected Shipment”/“New Manifest” now navigate to dedicated create routes using the legacy form. |
| DLE-2026-02-16-016 | 2026-02-16 | DL-2026-02-16-010 | completed | `src/pages/ShipmentCreate.tsx` | builder | Supports expected vs manifest inbound_kind, prefills notes from account defaults, and redirects to Incoming detail pages when created from `/incoming/*`. |
| DLE-2026-02-16-017 | 2026-02-16 | DL-2026-02-16-010 | completed | `src/App.tsx` | builder | Added `/incoming/expected/new` and `/incoming/manifest/new` routes. |

