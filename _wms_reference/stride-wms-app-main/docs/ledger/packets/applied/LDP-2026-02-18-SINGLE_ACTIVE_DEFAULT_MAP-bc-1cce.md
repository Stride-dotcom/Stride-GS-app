# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-SINGLE_ACTIVE_DEFAULT_MAP-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `SINGLE_ACTIVE_DEFAULT_MAP`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_SINGLE_ACTIVE_DEFAULT_MAP_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-011 | add | Heat Map Viewer and Dashboard Heat Map tile always use the warehouse Default Map (single active map) | accepted | Templates may exist but are not selectable in the viewer. |

## Detailed Decision Entries

### DL-2026-02-18-011: Heat Map Viewer and Dashboard Heat Map tile always use the warehouse Default Map (single active map)
- Domain: Heat Map / Map Selection
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_SINGLE_ACTIVE_DEFAULT_MAP_2026-02-18_chat-bc-1cce.md#qa-map-2026-02-18-001`
- Supersedes: -
- Superseded by: -

#### Decision
Heat Map Viewer and the Dashboard Heat Map tile should always render the warehouse’s Default Map (single active map). Tenants may create additional maps as templates, but those maps are not selectable in the viewer.

#### Why
Keeps operations consistent and avoids confusion/fragmentation when multiple template maps exist.

#### Implementation impact
- Viewer data loading should resolve the default map for the selected warehouse (no viewer-side map dropdown).
- If no default map exists, show a “No map configured” empty state with a create-map call-to-action.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-011 | 2026-02-19 | DL-2026-02-18-011 | completed | `src/pages/WarehouseHeatMap.tsx`, `src/components/dashboard/HeatMapHeroTile.tsx` | gpt-5.3-codex-high | Heat Map Viewer + dashboard tile resolve and render only the warehouse Default Map (no viewer-side map selector). |

