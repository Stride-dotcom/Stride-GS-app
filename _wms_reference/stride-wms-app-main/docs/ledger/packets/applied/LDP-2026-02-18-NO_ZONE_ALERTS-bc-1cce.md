# Ledger Pending Packet

- Packet ID: `LDP-2026-02-18-NO_ZONE_ALERTS-bc-1cce`
- Date: `2026-02-18`
- Topic slug: `NO_ZONE_ALERTS`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_NO_ZONE_ALERTS_2026-02-18_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-18-010 | add | Do not emit zone-level (heat map) alerts; rely on per-location capacity alerts | accepted | Prevents redundant/duplicate alerting; heat map remains a visualization. |

## Detailed Decision Entries

### DL-2026-02-18-010: Do not emit zone-level (heat map) alerts; rely on per-location capacity alerts
- Domain: Alerts / Heat Map
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_NO_ZONE_ALERTS_2026-02-18_chat-bc-1cce.md#qa-alert-2026-02-18-002`
- Supersedes: `DL-2026-02-18-009`
- Superseded by: -

#### Decision
Do not build zone/heat-map alert notifications. Capacity alerting should remain at the per-location level to avoid redundant/duplicate alerts.

#### Why
Zone utilization thresholds can easily overlap with per-location capacity thresholds and create confusing duplicate notifications. The heat map is intended as a visual “at a glance” tool.

#### Implementation impact
- Do **not** ship `rpc_evaluate_zone_alerts` and do **not** wire zone threshold events into Communications/Alert Queue.
- Heat map may still **visually** represent utilization via colors/legend and drill-down lists, but should not emit notification alerts based on zone thresholds.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-18-010 | 2026-02-19 | DL-2026-02-18-010 | completed | `supabase/migrations/20260219120000_hmv_p1_warehouse_maps_zones.sql` | gpt-5.3-codex-high | Confirmed zone-level alerting remains out of scope: no zone-alert tables/RPCs were added; heat map remains visualization-only. |

