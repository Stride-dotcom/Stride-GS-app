# Ledger Pending Packet

- Packet ID: `LDP-2026-02-15-HEAT_MAP_VISUALIZATION_PHASE1-bc-1cce`
- Date: `2026-02-15`
- Topic slug: `HEAT_MAP_VISUALIZATION_PHASE1`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-15-200 | add | Heat map phase implementation must map to existing schema names when possible | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-201 | add | Access matrix for HMV-P1 is builder admin+manager and viewer admin+manager+warehouse | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-202 | add | Rename this initiative to Heat Map & Visualization Phase 1 (HMV-P1) | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-203 | add | HMV-P1 includes Map Builder as prerequisite capability | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-204 | add | Heat viewer remains read-only but supports zone tap drill-down to location-level capacity list | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-205 | add | Final handoff process auto-resolves PR conflicts and verifies mergeability | accepted | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |
| DL-2026-02-15-206 | add | If scope overruns, visualizer sequencing may be deferred behind builder delivery | draft | Renumbered to avoid collision with existing DL IDs on 2026-02-15. |

## Detailed Decision Entries

### DL-2026-02-15-200: Heat map phase implementation must map to existing schema names when possible
- Domain: Heat Map / Data Integration
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-001`
- Supersedes: -
- Superseded by: -

#### Decision
Implement HMV-P1 using current Stride schema/field conventions wherever possible, and add compatibility layers only where contract semantics require it.

#### Why
User explicitly chose compatibility-first implementation to reduce migration drift and avoid unnecessary schema disruption.

#### Implementation impact
- Prefer existing columns/functions/table conventions in migrations/hooks/UI wiring.
- Document any unavoidable naming bridge explicitly.

### DL-2026-02-15-201: Access matrix for HMV-P1 is builder admin+manager and viewer admin+manager+warehouse
- Domain: Heat Map / Access Control
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-002`
- Supersedes: -
- Superseded by: -

#### Decision
Set HMV-P1 access as:
- Map Builder: admin + manager
- Heat Viewer: admin + manager + warehouse

#### Why
User provided explicit role access expectations for both build and view workflows.

#### Implementation impact
- Route guards and in-app entry points must enforce this matrix.
- Viewer remains broadly operational; builder remains elevated.

### DL-2026-02-15-202: Rename this initiative to Heat Map & Visualization Phase 1 (HMV-P1)
- Domain: Program Governance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-004`
- Supersedes: -
- Superseded by: -

#### Decision
Use "Heat Map & Visualization Phase 1 (HMV-P1)" as the planning and implementation phase label for this workstream.

#### Why
User explicitly changed phase naming because this is being treated as a new feature initiative.

#### Implementation impact
- Update planning references and execution summaries to HMV-P1 nomenclature.

### DL-2026-02-15-203: HMV-P1 includes Map Builder as prerequisite capability
- Domain: Heat Map / Scope
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-005`
- Supersedes: -
- Superseded by: -

#### Decision
Map Builder is in-scope for HMV-P1 because heat visualization is not usable before map creation/setup exists.

#### Why
User explicitly stated builder must be phase one due to dependency ordering.

#### Implementation impact
- Phase plan must sequence builder foundation before/with viewer enablement.
- Do not ship viewer-only if it leaves tenants without map authoring path.

### DL-2026-02-15-204: Heat viewer supports zone drill-down to location-level capacity list
- Domain: Heat Map / UX Behavior
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-003`
- Supersedes: -
- Superseded by: -

#### Decision
Heat Viewer remains read-only but includes zone tap/click drill-down showing location-level capacity/utilization details in a list/panel.

#### Why
User identified operational blind spot in zone-only aggregation and requested direct visibility into per-location availability.

#### Implementation impact
- Keep viewer non-editing.
- Add interaction model for zone detail inspection without per-zone API fanout.

### DL-2026-02-15-205: Final handoff process auto-resolves PR conflicts and verifies mergeability
- Domain: Delivery Process
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-006`
- Supersedes: -
- Superseded by: -

#### Decision
Before final handoff, the agent must auto-resolve PR conflicts and ensure the PR is mergeable without waiting for user conflict reports.

#### Why
User explicitly set this as a standing operating rule for future handoffs.

#### Implementation impact
- Add mergeability verification/conflict resolution as mandatory pre-handoff checklist.

### DL-2026-02-15-206: If scope overruns, visualizer sequencing may be deferred behind builder delivery
- Domain: Heat Map / Scope Contingency
- State: draft
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md#qa-hmv-2026-02-15-005`
- Supersedes: -
- Superseded by: -

#### Decision
If HMV-P1 scope overruns, visualizer sequencing may be deferred behind builder completion.

#### Why
User offered contingency language but did not define specific criteria/thresholds.

#### Implementation impact
- Requires explicit acceptance criteria for scope trigger before activation.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-15-200 | 2026-02-19 | DL-2026-02-15-200 | completed | `supabase/migrations/20260219120000_hmv_p1_warehouse_maps_zones.sql` | gpt-5.3-codex-high | Implemented HMV-P1 using existing schema conventions where possible (compatibility-first), aligning capacity math with existing location capacity primitives. |
| DLE-2026-02-15-201 | 2026-02-19 | DL-2026-02-15-201 | completed | `src/App.tsx` | gpt-5.3-codex-high | Enforced access matrix: Map Builder restricted to admin/tenant_admin/manager; Heat Viewer allowed for admin/tenant_admin/manager/warehouse/warehouse_staff. |
| DLE-2026-02-15-202 | 2026-02-19 | DL-2026-02-15-202 | completed | `supabase/migrations/20260219120000_hmv_p1_warehouse_maps_zones.sql`, `docs/PHASE_5_1_WAREHOUSE_MAP_ZONES_BUILD_OUT_PLAN.md` | gpt-5.3-codex-high | Adopted “HMV-P1” naming in migration headers and build-out plan artifacts. |
| DLE-2026-02-15-203 | 2026-02-19 | DL-2026-02-15-203 | completed | `src/pages/WarehouseMapBuilder.tsx`, `src/App.tsx` | gpt-5.3-codex-high | Shipped Map Builder as prerequisite capability for Heat Viewer; routes wired and gated by roles. |
| DLE-2026-02-15-204 | 2026-02-19 | DL-2026-02-15-204 | completed | `src/pages/WarehouseHeatMap.tsx`, `supabase/migrations/20260219150000_hmv_p1_zone_location_capacity_rpc.sql` | gpt-5.3-codex-high | Implemented read-only Heat Viewer with zone tap/click drill-down to location-level capacity list via zone-scoped RPC. |
| DLE-2026-02-15-205 | 2026-02-15 | DL-2026-02-15-205 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_HEAT_MAP_VISUALIZATION_PHASE1_2026-02-15_chat-bc-1cce.md` | gpt-5.3-codex-high | Captured mandatory pre-handoff mergeability/conflict-resolution rule. |
