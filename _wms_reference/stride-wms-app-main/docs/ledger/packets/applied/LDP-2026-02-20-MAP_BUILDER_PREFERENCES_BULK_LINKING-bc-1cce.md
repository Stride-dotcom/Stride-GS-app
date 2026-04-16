# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-20-MAP_BUILDER_PREFERENCES_BULK_LINKING-bc-1cce`
- Topic: Map Builder Preferences bulk-linking workspace (mockup-first)
- Topic Slug: `MAP_BUILDER_PREFERENCES_BULK_LINKING`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-20`
- Actor: `gpt-5.3-codex-high`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `8`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-20-001..008`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-20-001 | Mockup-first gate: finalize Preferences workflow before implementation | Map Builder Delivery Process | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-001` | - | - |
| DL-2026-02-20-002 | Preferences includes setup and review/coverage views for Zones, Zone Alias, and Zone Groups | Map Builder Preferences IA | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-002` | - | - |
| DL-2026-02-20-003 | Zone is the primary first column and assignment anchor in preferences tables | Map Builder Preferences UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-003` | - | - |
| DL-2026-02-20-004 | Column headers are autocomplete multi-select search fields with live filtering | Map Builder Preferences UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-004` | - | - |
| DL-2026-02-20-005 | Support staged multi-configuration (zone links + alias + group) with explicit Save commit | Map Builder Preferences Workflow | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-005` | - | - |
| DL-2026-02-20-006 | Each preferences column/list region is independently scrollable for dense datasets | Map Builder Preferences UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-006` | - | - |
| DL-2026-02-20-007 | Add help tool icons for each field/column with usage guidance | Map Builder UX Guidance | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-007` | - | - |
| DL-2026-02-20-008 | Preferences panel is drag-resizable and can expand left while shrinking map canvas | Map Builder Layout | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-008` | - | - |

## Detailed Decision Entries

### DL-2026-02-20-001: Mockup-first gate: finalize Preferences workflow before implementation
- Domain: Map Builder Delivery Process
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-001`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Do not start implementation for this preferences redesign until the mockup/workflow is finalized in Q&A.

#### Why
The interaction model is complex (bulk linking, multi-column filtering, staged save). Mockup-first reduces rework.

#### Implementation impact
- Build activity is paused for this feature until mockup acceptance.
- Capture decisions in ledger before coding.

### DL-2026-02-20-002: Preferences includes setup and review/coverage views for Zones, Zone Alias, and Zone Groups
- Domain: Map Builder Preferences IA
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-002`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Preferences must provide dedicated setup tooling and a review/coverage view for zone linking, zone aliases, and zone groups.

#### Why
Operators need one area for fast editing and a separate perspective for validation/completeness checks.

#### Implementation impact
- Preferences IA includes at least two modes: Setup and Review Coverage.
- Tables and summary coverage metrics are both required.

### DL-2026-02-20-003: Zone is the primary first column and assignment anchor in preferences tables
- Domain: Map Builder Preferences UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-003`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
In setup tables, place Zone first and treat Zone as the assignment anchor for linking locations, setting zone alias, and assigning zone groups.

#### Why
All requested operations are zone-centered; putting Zone first aligns with user mental model and reduces navigation effort.

#### Implementation impact
- Column order in setup view starts with Zone.
- Bulk actions and target selectors are keyed by selected zone(s).

### DL-2026-02-20-004: Column headers are autocomplete multi-select search fields with live filtering
- Domain: Map Builder Preferences UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-004`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Each header cell (`Zone`, `Location`, `Zone Alias`, `Zone Group`) is an interactive search control with autocomplete, multi-select chips, and live filter behavior.

#### Why
Header-level filtering allows users to rapidly narrow large lists (e.g., all `A1*` locations) and perform bulk actions.

#### Implementation impact
- Replace static headers with filter controls.
- Support live filtering and “select all filtered”.
- Placeholder text mirrors the column label.

### DL-2026-02-20-005: Support staged multi-configuration (zone links + alias + group) with explicit Save commit
- Domain: Map Builder Preferences Workflow
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-005`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Users can stage multiple related configuration choices in one pass (link locations to zone, set alias, set group) and persist changes only when explicit Save is clicked.

#### Why
This supports efficient high-volume edits while preventing accidental instant writes from intermediate filtering/selection actions.

#### Implementation impact
- Introduce staged/dirty state model for preferences edits.
- Add explicit Save action that commits all staged operations in batch.

### DL-2026-02-20-006: Each preferences column/list region is independently scrollable for dense datasets
- Domain: Map Builder Preferences UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-006`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Each column/list area in the compact preferences panel must be independently scrollable.

#### Why
In a constrained sidebar width/height, independent column scroll keeps long datasets usable without losing nearby context.

#### Implementation impact
- Per-column scroll containers (and likely virtualization for performance).
- Sticky controls remain visible while list panes scroll.

### DL-2026-02-20-007: Add help tool icons for each field/column with usage guidance
- Domain: Map Builder UX Guidance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-007`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Add `(i)` help icons near each field/column explaining intent and recommended usage workflow.

#### Why
The bulk-linking interactions are powerful but non-trivial; inline guidance reduces errors and onboarding time.

#### Implementation impact
- Add contextual tooltip/help content for Zone, Location, Zone Alias, Zone Group, and save workflow.

### DL-2026-02-20-008: Preferences panel is drag-resizable and can expand left while shrinking map canvas
- Domain: Map Builder Layout
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_PREFERENCES_BULK_LINKING_2026-02-20_chat-bc-1cce.md#qa-mbp-2026-02-20-008`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-20
- Locked at: -

#### Decision
Allow users to resize the preferences panel with a drag handle; when widened, it expands left and the map area shrinks accordingly.

#### Why
Users need extra horizontal space for table-heavy configuration tasks without leaving the map page.

#### Implementation impact
- Convert map/preferences layout to adjustable split pane.
- Persist per-user pane width preference.

## Implementation Log Rows

| DLE-2026-02-20-001 | 2026-02-20 | DL-2026-02-20-001 | planned | `docs/ledger/packets/pending/LDP-2026-02-20-MAP_BUILDER_PREFERENCES_BULK_LINKING-bc-1cce.md` | gpt-5.3-codex-high | Captured mockup-first decisions; implementation intentionally deferred until user approves the mockup. |

