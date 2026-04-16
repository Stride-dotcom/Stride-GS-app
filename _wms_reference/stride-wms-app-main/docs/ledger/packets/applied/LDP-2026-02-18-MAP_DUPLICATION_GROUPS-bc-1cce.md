# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-MAP_DUPLICATION_GROUPS-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `MAP_DUPLICATION_GROUPS`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_DUPLICATION_GROUPS_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-007 | add | Map duplication copies Groups and Group labels | accepted | Supports template workflows via map duplication. |

## Detailed Decision Entries

### DL-2026-02-18-007: Map duplication copies Groups and Group labels
- Domain: Map Builder / Duplication
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_DUPLICATION_GROUPS_2026-02-18_chat-bc-1cce.md#qa-map-dup-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
Duplicating a map should copy Group definitions and Group labels into the new map.

#### Why
Users rely on map duplication for template workflows; retaining group structure avoids repeating organizational setup.

#### Implementation impact
- Map-duplication logic must clone group metadata and group label nodes alongside geometry.
- This does not change rectangle copy/paste behavior (geometry-only).

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-007 | 2026-02-19 | DL-2026-02-18-007 | completed | `supabase/migrations/20260219160000_hmv_p1_map_node_group_labels.sql`, `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented map-specific Groups via `warehouse_map_nodes.group_label` and ensured “Duplicate map” clones all nodes including their group labels. |

