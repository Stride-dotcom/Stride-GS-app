# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-dock-intake-carrier-tracking-reference-fields-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Dock Intake Stage 1 carrier / tracking / reference fields
- Topic Slug: `DOCK_INTAKE_CARRIER_TRACKING_REFERENCE_FIELDS`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_CARRIER_TRACKING_REFERENCE_FIELDS_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-005`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-005 | Dock Intake Stage 1 must capture carrier, tracking, and reference/PO fields (autosaved) | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_CARRIER_TRACKING_REFERENCE_FIELDS_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md#decision-summary` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-005: Dock Intake Stage 1 must capture carrier, tracking, and reference/PO fields (autosaved)
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_CARRIER_TRACKING_REFERENCE_FIELDS_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md#decision-summary`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Dock Intake Stage 1 must provide inputs for Carrier name, Tracking number, and Reference/PO number, and the values must autosave onto the associated shipment record.

#### Why
These shipping-identification fields are needed during receiving for operational parity with legacy workflows and for downstream search/matching.

#### Implementation impact
- UI: `src/components/receiving/Stage1DockIntake.tsx` add fields + autosave behavior.
- Data: persist on shipment record (carrier/tracking/reference fields).

## Implementation Log Rows

| DLE-2026-02-16-005 | 2026-02-16 | DL-2026-02-16-005 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Added Carrier Name, Tracking #, and Reference/PO # inputs to Dock Intake Stage 1 and autosave to shipment. |

