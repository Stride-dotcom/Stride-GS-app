# Locked Decision Source Artifact

- Topic: Map Builder Preferences bulk-linking workspace (mockup-first)
- Topic slug: `MAP_BUILDER_PREFERENCES_BULK_LINKING`
- Date: `2026-02-20`
- Chat ID: `bc-1cce`
- Source mode: `current_chat`
- Source path: `N/A`
- Actor: `gpt-5.3-codex-high`

## Extracted Q&A / directives (explicit only)

### QA-MBP-2026-02-20-001
- Context: Implementation sequencing.
- Decision:
  - Do not start implementation yet; produce mockup/design first.

### QA-MBP-2026-02-20-002
- Context: Preferences information architecture.
- Decision:
  - Preferences should include dedicated tabs/sections for Zones, Zone Alias, and Zone Groups.
  - The preferences area should also include a setup workflow view and a review/coverage view.

### QA-MBP-2026-02-20-003
- Context: High-volume linkage workflow.
- Decision:
  - Zone becomes the first/primary column because all linking actions are zone-centered:
    - choose zone to link locations,
    - choose zone to assign zone alias,
    - choose multiple zones to assign one zone group.

### QA-MBP-2026-02-20-004
- Context: Column interaction model.
- Decision:
  - Each column header (`zone`, `location`, `zone alias`, `zone group`) should be a search input.
  - Placeholder text should match the column name.
  - Inputs should support autocomplete, multi-select, and live filtering as the user types.
  - Users can filter (e.g., `a1`), then multi-select or select all filtered rows.

### QA-MBP-2026-02-20-005
- Context: Assignment semantics after filtering.
- Decision:
  - Users should be able to filter/select locations, then filter/select a target zone and apply linkage.
  - Users should be able to select multiple zones and assign one zone group.
  - Workflow should support staging multiple related choices before persisting.
  - Persist only when user clicks explicit Save.

### QA-MBP-2026-02-20-006
- Context: Sidebar real estate constraints.
- Decision:
  - Because the preferences section is narrow, each column/list area must be independently scrollable.

### QA-MBP-2026-02-20-007
- Context: UX guidance/discoverability.
- Decision:
  - Add help tool icons `(i)` with usage tips for each field/column and expected workflow.

### QA-MBP-2026-02-20-008
- Context: Layout control.
- Decision:
  - Preferences panel should support drag-to-resize width, expanding left while shrinking the map area.

