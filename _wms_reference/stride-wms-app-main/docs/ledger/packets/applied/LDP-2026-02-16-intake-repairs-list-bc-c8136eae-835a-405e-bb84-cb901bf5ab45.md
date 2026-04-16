# LDP-2026-02-16-intake-repairs-list-bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## Decision Index Rows

| decision_id | date | topic_slug | summary | status | source_artifact |
|---|---|---|---|---|---|
| DL-2026-02-16-015 | 2026-02-16 | intake-stage1-stage2-combined | Dock Intake Stage 1 completion must keep Stage 2 on the same page (expandable), with “Continue to Stage 2”, Stage 1 remaining editable, and photos/docs continuing in the same buckets. | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |
| DL-2026-02-16-016 | 2026-02-16 | intake-signature-preview-edit | Signature capture (drawn/typed) must render immediately in the signature field and change the action button from Capture → Edit. | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |
| DL-2026-02-16-017 | 2026-02-16 | intake-exceptions-save | Dock Intake exception chips must save properly, including “Other” requiring a note; notes must persist. | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |
| DL-2026-02-16-018 | 2026-02-16 | intake-piece-counts-triple-mismatch | Implement 3-piece-count model (paperwork, counted, entered) with mismatch prompting and required exception note handling. | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |
| DL-2026-02-16-019 | 2026-02-16 | intake-mis-ship-exception-chip | Add Mis-Ship as an exception chip that works end-to-end (indicator + any required updates). | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |
| DL-2026-02-16-020 | 2026-02-16 | intake-document-camera-bw-pdf-scan | Document camera must produce a true black & white PDF scan (app-side), not rely on device conversion. | draft | docs/ledger/sources/LOCKED_DECISION_SOURCE_INTAKE_REPAIRS_LIST_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md |

## Detailed Decision Entries

### DL-2026-02-16-015: Dock Intake Stage 1 completion keeps Stage 2 on same page (draft)
- Goal: Combine Stage 1 + Stage 2 into a single dock intake page flow after Stage 1 completion.
- Clarifications: proceed via Hub → Intakes in Progress → intake; “Continue to Stage 2”; Stage 1 editable; same buckets; confirmation inline reminder (not blocking).
- Open: confirm the exact human-readable labels for `inbound_status` on the Hub (“draft”, “stage1_complete”, “receiving”), and ensure mapping is UI-only (no new workflow states).

### DL-2026-02-16-016: Signature capture preview renders immediately and button becomes Edit (draft)
- Goal: signature preview must reflect captured signature; button changes to Edit.
- Open: confirm exact screens where this must apply (Stage 1, inline confirmation, Stage 2).

### DL-2026-02-16-017: Dock Intake exception chips save properly (including Other note) (draft)
- Goal: exception chip toggles must create/persist `shipment_exceptions` records; “Other” requires note and persists.
- Open: confirm intended exception code list for dock intake (condition exceptions vs matching discrepancies).

### DL-2026-02-16-018: 3-piece-count model with mismatch prompts and required exception note (draft)
- Goal: three piece counts (paperwork, counted, entered) + mismatch prompts and exception note requirement.
- Open: confirm DB field mapping and whether mismatches block progression.

### DL-2026-02-16-019: Mis-Ship exception chip works end-to-end (draft)
- Goal: Mis-Ship chip behaves correctly and drives indicators/updates.
- Open: confirm roles allowed and required downstream actions (quarantine/return draft/etc).

### DL-2026-02-16-020: Document camera produces true B/W PDF scan (app-side) (draft)
- Goal: implement true B/W scan to PDF from in-app capture.
- Open: confirm target platforms (web/iOS/Android) and required scan features (crop/deskew vs threshold only).

## Implementation Log Rows

| event_id | date | decision_id | type | summary |
|---|---|---|---|---|
| DLE-2026-02-16-028 | 2026-02-16 | DL-2026-02-16-015..020 | docs | Captured intake repairs list and initial clarifications; repairs not started yet. |

