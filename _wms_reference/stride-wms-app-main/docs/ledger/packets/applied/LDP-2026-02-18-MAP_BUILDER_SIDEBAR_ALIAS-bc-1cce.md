# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-MAP_BUILDER_SIDEBAR_ALIAS-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `MAP_BUILDER_SIDEBAR_ALIAS`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_SIDEBAR_ALIAS_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-001 | add | Map Builder preferences sidebar sections remain available regardless of selection | accepted | Avoid disappearing tools due to selection clearing. |
| DL-2026-02-18-002 | add | Map Builder preferences sidebar uses dropdown section switcher (not tabs) | accepted | Sidebar contains Properties + Zones + Alias + Groups modes. |
| DL-2026-02-18-003 | add | Use term Alias (not Nickname) across map/zone labeling UX | accepted | Rename in UI copy and build-out artifacts. |

## Detailed Decision Entries

### DL-2026-02-18-001: Map Builder preferences sidebar sections remain available regardless of selection
- Domain: Map Builder UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_SIDEBAR_ALIAS_2026-02-18_chat-bc-1cce.md#qa-map-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
In Map Builder, keep preferences sidebar sections available regardless of whether a selection exists, and ensure interacting with the sidebar does not clear selection in a way that makes tools disappear.

#### Why
Selection-gated tabs that disappear when focus changes are confusing and slow, especially on tablet/mobile where accidental deselection is common.

#### Implementation impact
- Sidebar renders all tool sections via a section selector, with empty states when selection is required.
- Clicking/typing in the sidebar must not clear the current canvas selection.

### DL-2026-02-18-002: Map Builder preferences sidebar uses dropdown section switcher (not tabs)
- Domain: Map Builder UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_SIDEBAR_ALIAS_2026-02-18_chat-bc-1cce.md#qa-map-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
Use a dropdown section switcher (not tabs) in the Map Builder preferences sidebar to navigate between sections (e.g., Properties, Zones, Alias, Groups).

#### Why
As the sidebar adds multiple tools, a dropdown is simpler and avoids a cramped/tab-overflow UI.

#### Implementation impact
- Add a dropdown selector at top of sidebar.
- Persist last selected sidebar section per user where appropriate.

### DL-2026-02-18-003: Use term Alias (not Nickname) across map/zone labeling UX
- Domain: Terminology / UX Copy
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_BUILDER_SIDEBAR_ALIAS_2026-02-18_chat-bc-1cce.md#qa-map-2026-02-18-002`
- Supersedes: -
- Superseded by: -

#### Decision
Use the term "Alias" instead of "Nickname" throughout heat map visualization features (zone alias, suggested alias, alias assistant UI).

#### Why
"Alias" is shorter and better matches the intent (a label/handle for a zone), and avoids confusion with user names.

#### Implementation impact
- Rename UI labels from "Nickname" to "Alias".
- Update future Q&A/build-out plan references accordingly.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-001 | 2026-02-19 | DL-2026-02-18-001 | completed | `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented preferences sidebar that remains available regardless of selection; selection tools do not disappear when focus changes. |
| DLE-2026-02-18-002 | 2026-02-19 | DL-2026-02-18-002 | completed | `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented dropdown section switcher for sidebar sections (Properties / Zones / Alias / Groups). |
| DLE-2026-02-18-003 | 2026-02-19 | DL-2026-02-18-003 | completed | `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Updated map UI terminology to “Alias” for zone label overrides. |

