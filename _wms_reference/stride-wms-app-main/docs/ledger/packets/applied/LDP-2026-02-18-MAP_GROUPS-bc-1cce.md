# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-MAP_GROUPS-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `MAP_GROUPS`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_GROUPS_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-004 | add | Map Builder uses Groups (not Rows) for zone collections and group labels | accepted | Terminology + mental model: groups are user-defined collections. |
| DL-2026-02-18-005 | add | Allow applying a group label to any mixed selection of zones | accepted | Users can group zones into rows/sections/etc. without restrictions. |

## Detailed Decision Entries

### DL-2026-02-18-004: Map Builder uses Groups (not Rows) for zone collections and group labels
- Domain: Map Builder UX / Terminology
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_GROUPS_2026-02-18_chat-bc-1cce.md#qa-group-2026-02-18-002`
- Supersedes: -
- Superseded by: -

#### Decision
In the map feature, use the term "Group" instead of "Row" for collections of zones and their map labels. Groups can represent rows, warehouse sections, or any user-defined set of zones.

#### Why
Not all warehouses organize zones strictly by rows; "Group" keeps the feature flexible and matches user intent.

#### Implementation impact
- Rename UI sections from "Rows" / "Row Labels" to "Groups" / "Group Labels".
- Ensure this does not conflict with the Location Type "Row" (locations.type) concept.

### DL-2026-02-18-005: Allow applying a group label to any mixed selection of zones
- Domain: Map Builder UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_GROUPS_2026-02-18_chat-bc-1cce.md#qa-group-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
When multiple zones are selected (even from different existing groups), allow applying one group label to the entire selection. Users can define groups however they want.

#### Why
Restricting grouping to a single "row" shape makes the tool brittle and slows setup; mixed selection grouping enables quick organization by real-world layouts.

#### Implementation impact
- Group assignment action merges the selected zones into the specified/new group.
- Existing group membership for those zones is replaced by the new grouping.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-004 | 2026-02-19 | DL-2026-02-18-004 | completed | `supabase/migrations/20260219160000_hmv_p1_map_node_group_labels.sql`, `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented “Groups” terminology and group labels stored on map nodes (`group_label`). |
| DLE-2026-02-18-005 | 2026-02-19 | DL-2026-02-18-005 | completed | `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented mixed selection grouping: apply a group label to any multi-selection (Shift+click/box-select), replacing prior group membership. |

