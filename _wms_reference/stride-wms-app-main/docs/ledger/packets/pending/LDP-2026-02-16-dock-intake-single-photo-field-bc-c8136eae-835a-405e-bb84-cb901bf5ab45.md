# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-dock-intake-single-photo-field-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Dock Intake Stage 1 single Photos field (legacy parity)
- Topic Slug: `DOCK_INTAKE_SINGLE_PHOTO_FIELD`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_SINGLE_PHOTO_FIELD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-007`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-007 | Dock Intake Stage 1 uses a single legacy Photos field and requires >= 1 total photo | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_SINGLE_PHOTO_FIELD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-007: Dock Intake Stage 1 uses a single legacy Photos field and requires >= 1 total photo
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_SINGLE_PHOTO_FIELD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Dock Intake Stage 1 must use a single legacy-style Photos capture/upload field (no separate Paperwork/Condition photo sections), persist photos on `shipments.receiving_photos`, and require at least one photo total for Stage 1 completion.

#### Why
This restores legacy UX parity and reduces operator friction/duplication during dock intake.

#### Implementation impact
- UI: `src/components/receiving/Stage1DockIntake.tsx` consolidate photo capture/upload into one Photos section and update validation.
- UI: `src/components/receiving/ConfirmationGuard.tsx` reflect the single Photos count.
- Data: one-time bootstrap from legacy `shipment_photos` into `shipments.receiving_photos` to avoid losing already-captured images.

## Implementation Log Rows

| DLE-2026-02-16-007 | 2026-02-16 | DL-2026-02-16-007 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Replaced Paperwork/Condition photo panels with a single legacy Photos section and updated Stage 1 validation to require >= 1 total photo. |
| DLE-2026-02-16-008 | 2026-02-16 | DL-2026-02-16-007 | completed | `src/components/receiving/ConfirmationGuard.tsx` | builder | Switched photo count summary to `shipments.receiving_photos` (single Photos count). |
| DLE-2026-02-16-009 | 2026-02-16 | DL-2026-02-16-007 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Added one-time bootstrap from legacy `shipment_photos` into `shipments.receiving_photos` to preserve already-captured images. |

