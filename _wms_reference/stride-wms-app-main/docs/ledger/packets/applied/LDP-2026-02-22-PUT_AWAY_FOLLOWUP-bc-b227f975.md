# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-22-PUT_AWAY_FOLLOWUP-bc-b227f975`
- Topic: Put Away assistant follow-up decisions (post-gap review)
- Topic Slug: `PUT_AWAY_FOLLOWUP`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-22`
- Actor: `gpt-5.3-codex-high`
- Status: `applied`

## Scope Summary

- Q&A items extracted: `5`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-22-001`, `DL-2026-02-22-002`, `DL-2026-02-22-003`, `DL-2026-02-22-004`, `DL-2026-02-22-005`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-22-001 | Put Away tile top suggestion must be selectable in collapsed state | Put Away Assistant UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-001` | - | - |
| DL-2026-02-22-002 | Dashboard uses Apple-like size-aware tile placement for mixed tile sizes | Dashboard Layout UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-002` | - | - |
| DL-2026-02-22-003 | Put Away scanner capacity checks use batched item-size reads with live preview plus execute-time server validation | Put Away Scanner Performance/Validation | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-003` | - | - |
| DL-2026-02-22-004 | ScanHub blocking overlays use fully dynamic detailed reasons | ScanHub UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-004` | - | - |
| DL-2026-02-22-005 | Implement approved follow-up decisions in one pass | Delivery Process | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-005` | - | - |

## Detailed Decision Entries

### DL-2026-02-22-001: Put Away tile top suggestion must be selectable in collapsed state
- Domain: Put Away Assistant UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-001`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-22
- Locked at: -

#### Decision
The top-ranked suggested location for each Put Away row must be directly selectable while the Put Away card is collapsed.

#### Why
Operators need a fast-path workflow without mandatory row expansion, especially in mobile/tablet usage.

#### Implementation impact
- Update Put Away tile collapsed-row UI to include active top-suggestion radio selection.
- Ensure collapsed interaction remains consistent with capacity preview and final confirm behavior.

### DL-2026-02-22-002: Dashboard uses Apple-like size-aware tile placement for mixed tile sizes
- Domain: Dashboard Layout UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-002`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-22
- Locked at: -

#### Decision
Use Apple-like size-aware tile placement on Dashboard so smaller tiles move around larger tiles and avoid uneven/ragged rows.

#### Why
Mixed-width tiles (including full-width Put Away and Heat Map cards) must remain draggable without creating broken row geometry.

#### Implementation impact
- Keep full-width tile spans for larger cards.
- Use dense grid auto-placement so smaller cards reflow around larger cards automatically.

### DL-2026-02-22-003: Put Away scanner capacity checks use batched item-size reads with live preview plus execute-time server validation
- Domain: Put Away Scanner Performance/Validation
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-003`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-22
- Locked at: -

#### Decision
Scanner capacity checks must use opportunistic batched item-detail/size reads, perform live required-vs-available capacity checks on scanned destination, and still run final server-side validation at move execution.

#### Why
This preserves fast scanner throughput while preventing stale/unsafe moves.

#### Implementation impact
- Add debounced batched item detail reads for scanned item IDs.
- Keep destination capacity read/check in scanner flow and execute-time authoritative validation.

### DL-2026-02-22-004: ScanHub blocking overlays use fully dynamic detailed reasons
- Domain: ScanHub UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-004`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-22
- Locked at: -

#### Decision
All ScanHub blocking overlays must present dynamic, context-specific reason text rather than generic static labels.

#### Why
Operators need actionable scan feedback to recover quickly without ambiguity.

#### Implementation impact
- Replace generic operations-mode block reasons with detailed contextual strings.
- Ensure manual-path blocking overlays use same detailed style.

### DL-2026-02-22-005: Implement approved follow-up decisions in one pass
- Domain: Delivery Process
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md#qa-paway-followup-2026-02-22-005`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-22
- Locked at: -

#### Decision
Implement all approved follow-up decisions in one pass after Q&A closure.

#### Why
Reduces iteration overhead and ships cohesive behavior updates together.

#### Implementation impact
- Bundle accepted follow-up changes into a single integrated implementation pass.

## Implementation Log Rows

| DLE-2026-02-22-001 | 2026-02-22 | DL-2026-02-22-001 | planned | `docs/ledger/packets/pending/LDP-2026-02-22-PUT_AWAY_FOLLOWUP-bc-b227f975.md` | gpt-5.3-codex-high | Decision captured from follow-up Q&A; implementation pending explicit go-ahead. |
| DLE-2026-02-22-002 | 2026-02-22 | DL-2026-02-22-002 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md` | gpt-5.3-codex-high | Captured size-aware Dashboard tile reflow decision from follow-up Q&A. |
| DLE-2026-02-22-003 | 2026-02-22 | DL-2026-02-22-003 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md` | gpt-5.3-codex-high | Captured batched scanner capacity-check decision from follow-up Q&A. |
| DLE-2026-02-22-004 | 2026-02-22 | DL-2026-02-22-004 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md` | gpt-5.3-codex-high | Captured dynamic ScanHub blocking-overlay wording decision from follow-up Q&A. |
| DLE-2026-02-22-005 | 2026-02-22 | DL-2026-02-22-005 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_FOLLOWUP_2026-02-22_chat-bc-b227f975.md` | gpt-5.3-codex-high | Captured one-pass implementation approach decision for follow-up scope. |

