# Locked Decision Source Artifact

- Topic: Map Builder sidebar UX + terminology change (Nickname → Alias)
- Topic slug: `MAP_BUILDER_SIDEBAR_ALIAS`
- Date: `2026-02-18`
- Chat ID: `bc-1cce`
- Source mode: `current_chat`
- Actor: `gpt-5.3-codex-high`

## Extracted directives (explicit only)

### QA-MAP-2026-02-18-001
- Context: Map Builder right-sidebar usability with selection-based tools.
- Decision:
  - Do not hide/disable sidebar sections based on selection; keep all sections available when the preferences sidebar is open.
  - Avoid UX where clicking in the sidebar clears selection and causes tool sections to disappear.
  - Use a dropdown to switch between sections since the sidebar now contains multiple tools (Zones, Alias, Groups, etc.).

### QA-MAP-2026-02-18-002
- Context: Terminology.
- Decision:
  - Rename "Nicknames" to "Alias" throughout the UI and planning/build-out decisions.

