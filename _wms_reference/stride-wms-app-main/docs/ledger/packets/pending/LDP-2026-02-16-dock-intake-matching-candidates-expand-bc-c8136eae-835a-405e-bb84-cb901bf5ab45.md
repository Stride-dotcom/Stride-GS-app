# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-dock-intake-matching-candidates-expand-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Dock Intake matching candidates expand + bulk link
- Topic Slug: `DOCK_INTAKE_MATCHING_CANDIDATES_EXPAND`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_MATCHING_CANDIDATES_EXPAND_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-008`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-008 | Dock Intake matching candidates expand with item preview and support bulk “Link Selected” | Receiving UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_MATCHING_CANDIDATES_EXPAND_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-008: Dock Intake matching candidates expand with item preview and support bulk “Link Selected”
- Domain: Receiving UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCK_INTAKE_MATCHING_CANDIDATES_EXPAND_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
During Dock Intake creation, matching candidate rows must be expandable to show inline item preview details (qty, vendor, description, sidemark, room) and the UI must support multi-select with a bulk “Link Selected” action while preserving per-candidate linking.

#### Why
Operators need to verify candidate matches without leaving Dock Intake; inline previews and bulk linking reduce mis-linking and context switching.

#### Implementation impact
- UI: `src/components/incoming/DockIntakeMatchingPanel.tsx` add expandable row previews and bulk selection/linking.

## Implementation Log Rows

| DLE-2026-02-16-010 | 2026-02-16 | DL-2026-02-16-008 | completed | `src/components/incoming/DockIntakeMatchingPanel.tsx` | builder | Candidate rows are collapsible and show a line-item preview (qty/vendor/description/sidemark/room) to confirm matches before linking. |
| DLE-2026-02-16-011 | 2026-02-16 | DL-2026-02-16-008 | completed | `src/components/incoming/DockIntakeMatchingPanel.tsx` | builder | Added checkboxes + “Link Selected” bulk action to link multiple candidate shipments to one dock intake. |

