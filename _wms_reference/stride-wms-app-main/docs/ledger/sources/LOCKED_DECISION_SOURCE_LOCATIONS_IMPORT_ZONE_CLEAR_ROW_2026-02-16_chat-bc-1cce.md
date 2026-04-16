# Locked Decision Source Artifact

- Topic: Locations import guidance + zone CLEAR token + aisle→row rename
- Topic slug: `LOCATIONS_IMPORT_ZONE_CLEAR_ROW`
- Date: `2026-02-16`
- Chat ID: `bc-1cce`
- Source mode: `current_chat`
- Source path: `N/A`
- Actor: `gpt-5.3-codex-high`

## Extracted Q&A / directives (explicit only)

### QA-LOC-2026-02-16-001
- Context: Zone assignment import behavior.
- Decision:
  - Use `CLEAR` as the explicit import token to unassign a location's zone.

### QA-LOC-2026-02-16-002
- Context: Location import UX discoverability.
- Decision:
  - Add help tooltip icon next to the Locations import button.
  - Tooltip must explain:
    - Matching location codes are not duplicated (upsert semantics).
    - Existing locations can be exported to Excel, edited, and re-imported to make bulk changes.
    - `CLEAR` can be used to unassign zone (when zone import column is present).

### QA-LOC-2026-02-16-003
- Context: Location type terminology accuracy.
- Decision:
  - Rename stored location type from `aisle` to `row` now (pre-production), while ensuring nothing breaks.
  - Do not touch billing during this change.

