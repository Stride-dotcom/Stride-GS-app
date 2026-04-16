# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-ZONE_ALERT_EVAL_ON_DEFAULT-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `ZONE_ALERT_EVAL_ON_DEFAULT`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_ZONE_ALERT_EVAL_ON_DEFAULT_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-009 | add | Evaluate zone alerts immediately when a map becomes the default map | accepted | Ensures alert state reflects active/default map immediately. |

## Detailed Decision Entries

### DL-2026-02-18-009: Evaluate zone alerts immediately when a map becomes the default map
- Domain: Alerts / Heat Map
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_ZONE_ALERT_EVAL_ON_DEFAULT_2026-02-18_chat-bc-1cce.md#qa-alert-2026-02-18-001`
- Supersedes: -
- Superseded by: `DL-2026-02-18-010`

#### Decision
When an admin sets a map as the warehouse default, zone alert evaluation should run immediately so alerts reflect the newly-active map.

#### Why
Changing the default map changes the operational view of zones; alert state should be updated immediately to avoid stale or missing alerts.

#### Implementation impact
- Default-map setting flow should trigger `rpc_evaluate_zone_alerts(<default_map_id>)` (or equivalent evaluation) as part of the action.
- Ensure evaluation respects tenant safety and upward-transition rules.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-009 | 2026-02-18 | DL-2026-02-18-009 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_ZONE_ALERT_EVAL_ON_DEFAULT_2026-02-18_chat-bc-1cce.md` | gpt-5.3-codex-high | Captured immediate evaluation requirement on default map changes. |
| DLE-2026-02-19-002 | 2026-02-19 | DL-2026-02-18-009 | superseded | `docs/ledger/packets/pending/LDP-2026-02-18-NO_ZONE_ALERTS-bc-1cce.md` | gpt-5.3-codex-high | Superseded by DL-2026-02-18-010 (no zone-level alerts); zone alert evaluation RPC is intentionally not implemented in HMV-P1. |

