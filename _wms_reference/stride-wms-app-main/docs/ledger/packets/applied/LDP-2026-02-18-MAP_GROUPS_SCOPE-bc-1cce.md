# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-MAP_GROUPS_SCOPE-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `MAP_GROUPS_SCOPE`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_GROUPS_SCOPE_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-006 | add | Groups are map-specific; map duplication supports template workflows | accepted | Groups are not shared across maps. |

## Detailed Decision Entries

### DL-2026-02-18-006: Groups are map-specific; map duplication supports template workflows
- Domain: Map Builder UX / Groups
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_GROUPS_SCOPE_2026-02-18_chat-bc-1cce.md#qa-group-scope-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
Groups are map-specific (not shared across maps). Users can duplicate maps to create templates and edit as needed.

#### Why
Map duplication provides the reuse mechanism; keeping groups scoped to a map avoids cross-map coupling and keeps the feature flexible.

#### Implementation impact
- Group definitions live with the map (e.g., in map node metadata).
- Duplicating a map yields a new map with its own group structure (or no groups if copy rules specify).

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-006 | 2026-02-19 | DL-2026-02-18-006 | completed | `supabase/migrations/20260219160000_hmv_p1_map_node_group_labels.sql`, `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented Groups as map-specific labels stored on map nodes, with map duplication used as the reuse/template mechanism (groups are copied into the duplicated map, not shared). |

