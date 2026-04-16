# Ledger Pending Packet

- Packet ID: `LDP-2026-02-16-LOCATIONS_IMPORT_ZONE_CLEAR_ROW-bc-1cce`
- Date: `2026-02-16`
- Topic slug: `LOCATIONS_IMPORT_ZONE_CLEAR_ROW`
- Chat ID: `bc-1cce`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_IMPORT_ZONE_CLEAR_ROW_2026-02-16_chat-bc-1cce.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-16-001 | add | Use CLEAR token to explicitly unassign location zone in imports | accepted | Source: QA-LOC-2026-02-16-001 |
| DL-2026-02-16-002 | add | Add import help tooltip explaining upsert + export/edit/reimport workflow | accepted | Source: QA-LOC-2026-02-16-002 |
| DL-2026-02-16-003 | add | Rename stored location type from aisle to row (do not touch billing) | accepted | Source: QA-LOC-2026-02-16-003 |

## Detailed Decision Entries

### DL-2026-02-16-001: Use CLEAR token to explicitly unassign location zone in imports
- Domain: Locations Import / Zones
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_IMPORT_ZONE_CLEAR_ROW_2026-02-16_chat-bc-1cce.md#qa-loc-2026-02-16-001`
- Supersedes: -
- Superseded by: -

#### Decision
Use `CLEAR` (case-insensitive) as the explicit import token to unassign a location’s zone assignment.

#### Why
Blank cells should be able to mean “leave unchanged”; an explicit token is required for bulk unassignment.

#### Implementation impact
- Import parser must treat `CLEAR` as “set zone_id = NULL”.
- User-facing help text must document this token.

### DL-2026-02-16-002: Add import help tooltip explaining upsert + export/edit/reimport workflow
- Domain: Locations Import / UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_IMPORT_ZONE_CLEAR_ROW_2026-02-16_chat-bc-1cce.md#qa-loc-2026-02-16-002`
- Supersedes: -
- Superseded by: -

#### Decision
Add a help tooltip icon next to the Locations import button explaining:
- Import uses upsert semantics (matching codes are updated, not duplicated).
- Users can export current locations, edit in Excel, then re-import to apply bulk changes.
- `CLEAR` can be used to unassign zones (when zone import column is present).

#### Why
Without explicit guidance, users won’t discover the intended “export → edit → reimport” bulk-change workflow and may fear duplication.

#### Implementation impact
- Add a HelpTip next to Import action in Locations Settings.

### DL-2026-02-16-003: Rename stored location type from aisle to row (do not touch billing)
- Domain: Locations Data Model / Terminology
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_IMPORT_ZONE_CLEAR_ROW_2026-02-16_chat-bc-1cce.md#qa-loc-2026-02-16-003`
- Supersedes: -
- Superseded by: -

#### Decision
Rename stored location type from `aisle` to `row` now (pre-production), while ensuring backward compatibility and avoiding any billing changes.

#### Why
“Aisle” is the space between rows; “Row” is the correct concept for the stored location type value.

#### Implementation impact
- Add idempotent data migration to convert existing `locations.type='aisle'` to `row`.
- Keep UI/import compatibility to handle legacy `aisle` values safely.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-16-001 | 2026-02-19 | DL-2026-02-16-001 | completed | `src/components/settings/CSVImportDialog.tsx` | gpt-5.3-codex-high | Implemented `CLEAR` token handling in location imports to explicitly unassign a location’s zone (`zone_id = NULL`). |
| DLE-2026-02-16-002 | 2026-02-19 | DL-2026-02-16-002 | completed | `src/components/settings/LocationsSettingsTab.tsx` | gpt-5.3-codex-high | Added import help tooltip describing upsert semantics, export→edit→reimport workflow, and the `CLEAR` zone token. |
| DLE-2026-02-16-003 | 2026-02-16 | DL-2026-02-16-003 | completed | `supabase/migrations/20260216120000_locations_type_aisle_to_row.sql`, `src/lib/locationTypeUtils.ts` | gpt-5.3-codex-high | Implemented aisle→row stored rename with backward-compatible parsing/display. |

