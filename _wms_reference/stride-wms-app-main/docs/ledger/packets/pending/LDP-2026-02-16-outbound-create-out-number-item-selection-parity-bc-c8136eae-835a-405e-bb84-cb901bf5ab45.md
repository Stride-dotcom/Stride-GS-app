# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-outbound-create-out-number-item-selection-parity-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Outbound create OUT# + item selection parity
- Topic Slug: `OUTBOUND_CREATE_OUT_NUMBER_AND_ITEM_SELECTION_PARITY`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_OUTBOUND_CREATE_OUT_NUMBER_AND_ITEM_SELECTION_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-014`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-014 | Outbound create assigns OUT-##### on entry and restores inventory-style item selection + multi-select | Outbound Workflow | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_OUTBOUND_CREATE_OUT_NUMBER_AND_ITEM_SELECTION_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-014: Outbound create assigns OUT-##### on entry and restores inventory-style item selection + multi-select
- Domain: Outbound Workflow
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_OUTBOUND_CREATE_OUT_NUMBER_AND_ITEM_SELECTION_PARITY_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Outbound create must create a draft outbound shipment on page entry (to obtain an OUT-##### number immediately), fix shippable-item filtering to include `stored`, and restore inventory-like item selection columns with multi-select.

#### Why
Outbound creation must mirror inbound creation ergonomics and ensure operators can reliably select items to ship.

#### Implementation impact
- UI: `src/pages/OutboundCreate.tsx` create draft shipment on entry and show OUT# in header; expand item picker columns and preserve multi-select.
- Logic: `src/hooks/useOutbound.ts` (useAccountItems) include `stored` items and select inventory-style fields (location/room/class).

## Implementation Log Rows

| DLE-2026-02-16-025 | 2026-02-16 | DL-2026-02-16-014 | completed | `src/pages/OutboundCreate.tsx` | builder | OutboundCreate creates a draft shipment on entry and shows the OUT# in the header. |
| DLE-2026-02-16-026 | 2026-02-16 | DL-2026-02-16-014 | completed | `src/hooks/useOutbound.ts` | builder | useAccountItems includes `stored` items and selects location/room/class for inventory-style display. |
| DLE-2026-02-16-027 | 2026-02-16 | DL-2026-02-16-014 | completed | `src/pages/OutboundCreate.tsx` | builder | Outbound item picker columns expanded (location/room/class/type/sidemark) with multi-select preserved. |

