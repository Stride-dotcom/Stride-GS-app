# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-dock-intake-ui-cleanup-discrepancy-filtering-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Dock Intake UI cleanup + discrepancy exception filtering
- Topic Slug: `DOCK_INTAKE_UI_CLEANUP_AND_DISCREPANCY_EXCEPTION_FILTERING`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_UI_CLEANUP_AND_DISCREPANCY_EXCEPTION_FILTERING_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-009`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-009 | Dock Intake UI cleanup and hide matching/discrepancy mismatch codes from Exceptions UX | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_UI_CLEANUP_AND_DISCREPANCY_EXCEPTION_FILTERING_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-009: Dock Intake UI cleanup and hide matching/discrepancy mismatch codes from Exceptions UX
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_UI_CLEANUP_AND_DISCREPANCY_EXCEPTION_FILTERING_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Dock Intake Stage 1 must remove non-legacy UI elements (UNIDENTIFIED helper button and Vendor Name input), rename the summary section, remove mis-ship/return-to-sender action controls, and hide matching/discrepancy mismatch exception codes from the operator-facing Exceptions UX (operators only select physical/paperwork exceptions).

#### Why
This reduces operator confusion and enforces separation between user-selected condition exceptions and system-driven matching/discrepancy flags.

#### Implementation impact
- UI: `src/components/receiving/Stage1DockIntake.tsx` simplify Stage 1 UX and remove mismatch codes from exception chip selection.
- UI: `src/components/receiving/ReceivingStageRouter.tsx` remove top mis-ship/return-to-sender controls.
- Logic: `src/hooks/useShipmentExceptions.ts` filter out matching/discrepancy mismatch exception codes from lists and counts by default.

## Implementation Log Rows

| DLE-2026-02-16-012 | 2026-02-16 | DL-2026-02-16-009 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Removed UNIDENTIFIED helper button and Vendor Name input, renamed section to Shipment Summary, and removed mismatch codes from exception chip selection. |
| DLE-2026-02-16-013 | 2026-02-16 | DL-2026-02-16-009 | completed | `src/components/receiving/ReceivingStageRouter.tsx` | builder | Removed top mis-ship/return-to-sender exception action controls from the Receiving view. |
| DLE-2026-02-16-014 | 2026-02-16 | DL-2026-02-16-009 | completed | `src/hooks/useShipmentExceptions.ts` | builder | Default filters out matching/discrepancy mismatch exception codes from exceptions lists and counts. |

