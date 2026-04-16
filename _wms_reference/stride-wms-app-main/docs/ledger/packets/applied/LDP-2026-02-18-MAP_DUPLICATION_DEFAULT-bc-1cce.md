# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-MAP_DUPLICATION_DEFAULT-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `MAP_DUPLICATION_DEFAULT`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_DUPLICATION_DEFAULT_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-008 | add | Duplicating a map does not change the warehouse default map | accepted | Default map remains stable unless explicitly changed. |

## Detailed Decision Entries

### DL-2026-02-18-008: Duplicating a map does not change the warehouse default map
- Domain: Map Builder / Maps
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_MAP_DUPLICATION_DEFAULT_2026-02-18_chat-bc-1cce.md#qa-map-dup-2026-02-18-002`
- Supersedes: -
- Superseded by: -

#### Decision
Duplicating a map does not automatically change the warehouse’s default/active map. Users must set the default map manually if they want to activate the duplicate.

#### Why
Duplicated maps are often templates; automatically switching the default would be surprising and could disrupt active operations/visibility.

#### Implementation impact
- Map duplication flow creates a new map but leaves the current default unchanged.
- Provide clear “Set as default” action in map management UI.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-008 | 2026-02-19 | DL-2026-02-18-008 | completed | `src/pages/WarehouseMapBuilder.tsx` | gpt-5.3-codex-high | Implemented Map Builder “Duplicate map” action that creates a non-default copy and does not change the warehouse default map unless explicitly set. |

