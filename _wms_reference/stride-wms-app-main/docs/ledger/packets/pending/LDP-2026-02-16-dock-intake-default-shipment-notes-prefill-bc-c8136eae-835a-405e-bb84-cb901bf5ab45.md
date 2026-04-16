# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-dock-intake-default-shipment-notes-prefill-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Dock Intake Stage 1 default shipment notes prefill
- Topic Slug: `DOCK_INTAKE_DEFAULT_SHIPMENT_NOTES_PREFILL`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_DEFAULT_SHIPMENT_NOTES_PREFILL_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-006`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-006 | Dock Intake Stage 1 must prefill shipment notes from account defaults (no overwrite of user edits) | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_DEFAULT_SHIPMENT_NOTES_PREFILL_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md#decision-summary` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-006: Dock Intake Stage 1 must prefill shipment notes from account defaults (no overwrite of user edits)
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_DEFAULT_SHIPMENT_NOTES_PREFILL_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md#decision-summary`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
When an account is selected on Dock Intake Stage 1, the system must fetch the account’s default shipment notes and (only if the shipment notes are still blank/unmodified) prefill the shipment notes field without overwriting user edits; if configured, show a highlight callout so operators see the default notes.

#### Why
Operators rely on account-level default notes (SOP reminders, special handling). Prefilling restores legacy behavior and reduces missed intake instructions.

#### Implementation impact
- UI: `src/components/receiving/Stage1DockIntake.tsx` load `accounts.default_shipment_notes` (+ `highlight_shipment_notes`) when selecting an account.
- Ensure prefill runs once and never overwrites user-edited notes.

## Implementation Log Rows

| DLE-2026-02-16-006 | 2026-02-16 | DL-2026-02-16-006 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Fetch account default_shipment_notes + highlight flag and prefill shipment notes if blank/unmodified. |

