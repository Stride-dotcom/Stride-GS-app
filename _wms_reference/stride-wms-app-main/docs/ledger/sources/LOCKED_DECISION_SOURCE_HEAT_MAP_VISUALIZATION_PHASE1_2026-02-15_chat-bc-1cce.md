# Locked Decision Source Artifact

- Topic: Heat Map & Visualization Phase 1 planning kickoff
- Topic slug: `HEAT_MAP_VISUALIZATION_PHASE1`
- Date: `2026-02-15`
- Chat ID: `bc-1cce`
- Source mode: `current_chat`
- Source path: `N/A`
- Actor: `gpt-5.3-codex-high`

## Extraction rules

1. Capture only explicit decisions/directives from this chat.
2. Do not infer unstated implementation details.
3. Mark ambiguous/contingent items as `draft`.
4. Map each extracted item to an existing decision ID or a new candidate ID.

## Extracted Q&A / directives from chat

### QA-HMV-2026-02-15-001
- Context: Contract/schema alignment.
- Explicit decision: "Map to existing when possible."

### QA-HMV-2026-02-15-002
- Context: Access controls for map builder and heat map.
- Explicit decision:
  - Builder: admin + manager access.
  - Heat map: admin + manager + warehouse access.

### QA-HMV-2026-02-15-003
- Context: Heat map behavior.
- Explicit decision/preference:
  - Heat map should support tapping a zone to view detailed location utilization list.
  - User delegated phase placement to builder ("that should be up to you depending on what makes sense for the build out process").

### QA-HMV-2026-02-15-004
- Context: Program naming.
- Explicit decision:
  - Rename effort to "Heat Map and Visualization Phase One."

### QA-HMV-2026-02-15-005
- Context: Phase composition.
- Explicit decision:
  - Builder should be in phase one because heat map cannot be used before map setup.
  - Contingency noted: if scope is too large, visualizer sequencing may be adjusted.

### QA-HMV-2026-02-15-006
- Context: Delivery hygiene rule.
- Explicit decision/directive:
  - Before final handoff, auto-resolve PR conflicts and ensure PR is mergeable without waiting for user conflict reports.

## Decision mapping

No matching existing decision IDs were found for this heat map visualization scope in current ledger docs; all mappings below are new candidates.

| Source item | Mapping | State | Notes |
|---|---|---|---|
| QA-HMV-2026-02-15-001 | `DL-2026-02-15-200` (new candidate) | accepted | Schema/field naming compatibility policy. |
| QA-HMV-2026-02-15-002 | `DL-2026-02-15-201` (new candidate) | accepted | Access matrix for builder/viewer routes. |
| QA-HMV-2026-02-15-004 | `DL-2026-02-15-202` (new candidate) | accepted | Phase naming baseline. |
| QA-HMV-2026-02-15-005 | `DL-2026-02-15-203` (new candidate) | accepted | Builder is required in phase one. |
| QA-HMV-2026-02-15-003 | `DL-2026-02-15-204` (new candidate) | accepted | Read-only heat viewer with interactive drill-down. |
| QA-HMV-2026-02-15-006 | `DL-2026-02-15-205` (new candidate) | accepted | Handoff/mergeability policy. |
| QA-HMV-2026-02-15-005 (contingency clause) | `DL-2026-02-15-206` (new candidate) | draft | Scope contingency requires explicit trigger criteria. |

## Unresolved / draft items

- `DL-2026-02-15-206`: Criteria for invoking contingency sequencing (builder-first with deferred visualizer) is not yet explicitly defined.
