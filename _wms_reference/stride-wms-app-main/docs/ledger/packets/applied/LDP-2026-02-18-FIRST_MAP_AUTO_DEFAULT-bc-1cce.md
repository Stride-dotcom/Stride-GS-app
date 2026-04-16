# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-FIRST_MAP_AUTO_DEFAULT-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `FIRST_MAP_AUTO_DEFAULT`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_FIRST_MAP_AUTO_DEFAULT_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-012 | add | First created warehouse map auto-becomes Default Map | accepted | Reduces setup friction; viewer/tile rely on default map (DL-2026-02-18-011). |

## Detailed Decision Entries

### DL-2026-02-18-012: First created warehouse map auto-becomes Default Map
- Domain: Heat Map / Map Lifecycle
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_FIRST_MAP_AUTO_DEFAULT_2026-02-18_chat-bc-1cce.md#qa-map-2026-02-18-002`
- Supersedes: -
- Superseded by: -

#### Decision
If a warehouse has no maps and an admin/manager creates the first map, that map should automatically be set as the warehouse Default Map.

#### Why
The viewer/dashboard tile use the Default Map (DL-2026-02-18-011); auto-defaulting the first map minimizes “no map configured” friction for new tenants.

#### Implementation impact
- Map creation flow should detect “no maps exist for this warehouse” and set `is_default=true` on create (or immediately after create via a single transaction / guarded update).
- Default-map enforcement rules (unique partial index / trigger) still apply.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-012 | 2026-02-19 | DL-2026-02-18-012 | completed | `src/hooks/useWarehouseMaps.ts` | gpt-5.3-codex-high | Implemented “first map auto-default” behavior in map creation flow (first created map inserts with `is_default=true`). |

