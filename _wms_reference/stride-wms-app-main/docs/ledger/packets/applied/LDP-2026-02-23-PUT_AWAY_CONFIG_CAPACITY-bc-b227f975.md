# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-23-PUT_AWAY_CONFIG_CAPACITY-bc-b227f975`
- Topic: Put Away configuration + capacity/suggestion engine Q&A
- Topic Slug: `PUT_AWAY_CONFIG_CAPACITY`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-23`
- Actor: `gpt-5.3-codex-high`
- Status: `applied`

## Scope Summary

- Q&A items extracted: `16`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-23-001` .. `DL-2026-02-23-016`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| Decision ID | Title | Domain | State | Source | Supersedes | Superseded by |
|---|---|---|---|---|---|---|
| DL-2026-02-23-001 | Put Away exclusion list is tenant-wide per warehouse | Put Away Configuration Scope | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-001` | - | - |
| DL-2026-02-23-002 | Put Away configuration edit permissions are admin and manager only | Roles/Permissions | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-002` | - | - |
| DL-2026-02-23-003 | Suggestion engine auto-excludes active Put Away source locations | Put Away Suggestion Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-003` | - | - |
| DL-2026-02-23-004 | Put Away exclusions are hard exclusions | Put Away Suggestion Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-004` | - | - |
| DL-2026-02-23-005 | Flag details include requires-special-storage toggle with searchable multi-select locations | Flag Configuration UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-005` | - | - |
| DL-2026-02-23-006 | Put Away exclusions are configured in Settings > Organization > Preferences > Storage & Automation | Preferences IA | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-006` | - | - |
| DL-2026-02-23-007 | Storage & Automation settings are warehouse-scoped via section-level warehouse selector | Preferences UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-007` | - | - |
| DL-2026-02-23-008 | Required special-storage flags are hard compliance constraints for suggestions/moves | Suggestion Compliance Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-008` | - | - |
| DL-2026-02-23-009 | Multiple special-storage flags use intersection logic (must satisfy all) | Suggestion Compliance Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-009` | - | - |
| DL-2026-02-23-010 | Items without special-storage flags use normal ranking with exclusions applied | Suggestion Ranking Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-010` | - | - |
| DL-2026-02-23-011 | Non-compliant manual destinations can proceed via manager override with audit | Override Policy | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-011` | - | - |
| DL-2026-02-23-012 | Flags are global definitions; required-location mappings are per warehouse | Flag Data Model | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-012` | - | - |
| DL-2026-02-23-013 | Flag-required locations are edited in an all-warehouses mapping table | Flag Configuration UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-013` | - | - |
| DL-2026-02-23-014 | Missing compliant-location mapping for a warehouse is non-blocking with informational prompt | Compliance Fallback UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-014` | - | - |
| DL-2026-02-23-015 | Exclusion precedence wins over required-location mappings and only affects suggestions (not receiving assignment) | Suggestion Precedence Rules | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-015` | - | - |
| DL-2026-02-23-016 | Exclusion/compliance rule set is shared across all suggestion surfaces | Shared Suggestion Engine | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md#qa-paway-config-2026-02-23-016` | - | - |

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-23-001 | 2026-02-23 | DL-2026-02-23-001..DL-2026-02-23-016 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_PUT_AWAY_CONFIG_CAPACITY_QA_2026-02-23_chat-bc-b227f975.md` | gpt-5.3-codex-high | Captured one-by-one Q&A decisions for Put Away exclusions, per-warehouse flag mapping, and shared suggestion engine policy. |
