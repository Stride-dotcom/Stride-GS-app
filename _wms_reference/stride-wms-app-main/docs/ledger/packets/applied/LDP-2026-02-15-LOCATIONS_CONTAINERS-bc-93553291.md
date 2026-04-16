# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-15-LOCATIONS_CONTAINERS-bc-93553291`
- Topic: Locations and Containers
- Topic Slug: `LOCATIONS_CONTAINERS`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-15`
- Actor: `builder`
- Status: `applied`

## Scope Summary

- Q&A items extracted: `16`
- Existing decisions mapped: `0`
- New decisions added: `DL-2026-02-15-001..DL-2026-02-15-016`
- Unresolved/open (draft): `DL-2026-02-15-014, DL-2026-02-15-015, DL-2026-02-15-016`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-15-001 | Remove Quick Add Bay and standardize Storage Locations terminology | Locations UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-001` | - | - |
| DL-2026-02-15-002 | Location types are limited to aisle, bay, shelf, bin, dock, area; zone deferred to separate grouping column | Locations Data Model | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-002` | - | - |
| DL-2026-02-15-003 | Location export and template downloads use .xlsx with synced column definitions | Locations Import/Export | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-001`, `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-003` | - | - |
| DL-2026-02-15-004 | Location import must preserve legacy area inference and archived/inactive status round-trip | Locations Import/Export | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-004` | - | - |
| DL-2026-02-15-005 | Locations capture dimensions and compute square/cubic totals | Locations Capacity | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-001` | - | - |
| DL-2026-02-15-006 | Location detail header must not show duplicate/inconsistent storage icons | Locations UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-001` | - | - |
| DL-2026-02-15-007 | Containers are movable sub-locations and container moves must cascade contained item location updates | Containers | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-001`, `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-006` | - | - |
| DL-2026-02-15-008 | Container assignment scan flow is item scan then container scan | ScanHub | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-007` | - | - |
| DL-2026-02-15-009 | Remove parent location hierarchy UI and clear existing parent_location_id data | Locations Data Model | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-011`, `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-012` | - | - |
| DL-2026-02-15-010 | Default inbound/outbound selectors use searchable combobox filtering by code and name | Locations UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-013` | - | - |
| DL-2026-02-15-011 | Container management belongs in location-adjacent workflow, not item detail | Containers UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-014` | - | - |
| DL-2026-02-15-012 | Stocktake/outbound container bulk-scan shortcuts are controlled by organization preference toggles | Containers/ScanHub | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-015` | - | - |
| DL-2026-02-15-013 | Existing locations must remain editable | Locations UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-016` | - | - |
| DL-2026-02-15-014 | Item location rendering for contained items is unresolved (combined string vs separate fields) | Containers Data Model | draft | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-008` | - | - |
| DL-2026-02-15-015 | Scanner identity model for containers is unresolved (location type vs separate entity) | Containers Data Model | draft | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-010` | - | - |
| DL-2026-02-15-016 | Container code default format/auto-generation details remain draft pending final approval | Containers Data Model | draft | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-010` | - | - |

## Detailed Decision Entries

Imported and applied previously into master ledger:

- `DL-2026-02-15-001..DL-2026-02-15-016`

See canonical details in:

- `docs/LOCKED_DECISION_LEDGER.md`

## Implementation Log Rows

| DLE-2026-02-15-001 | 2026-02-15 | DL-2026-02-15-001 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured terminology + quick-add removal UX decision from chat Q&A source. |
| DLE-2026-02-15-002 | 2026-02-15 | DL-2026-02-15-002 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured standardized location type set with zone deferred as separate grouping column. |
| DLE-2026-02-15-003 | 2026-02-15 | DL-2026-02-15-003 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured .xlsx export/template + synced column contract decision. |
| DLE-2026-02-15-004 | 2026-02-15 | DL-2026-02-15-004 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured legacy area inference and archived round-trip import requirements. |
| DLE-2026-02-15-005 | 2026-02-15 | DL-2026-02-15-005 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured dimension-driven square/cubic capacity requirement for locations. |
| DLE-2026-02-15-006 | 2026-02-15 | DL-2026-02-15-006 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured location-detail header de-duplication of storage indicator. |
| DLE-2026-02-15-007 | 2026-02-15 | DL-2026-02-15-007 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured container movement cascade requirement for contained item locations. |
| DLE-2026-02-15-008 | 2026-02-15 | DL-2026-02-15-008 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured scanner sequence for containment assignment (item then container). |
| DLE-2026-02-15-009 | 2026-02-15 | DL-2026-02-15-009 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured parent-location UI removal and existing data cleanup requirement. |
| DLE-2026-02-15-010 | 2026-02-15 | DL-2026-02-15-010 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured searchable combobox behavior for default inbound/outbound selectors. |
| DLE-2026-02-15-011 | 2026-02-15 | DL-2026-02-15-011 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured container management placement outside item-detail context. |
| DLE-2026-02-15-012 | 2026-02-15 | DL-2026-02-15-012 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured organization-toggle control for stocktake/outbound container bulk scans. |
| DLE-2026-02-15-013 | 2026-02-15 | DL-2026-02-15-013 | planned | Updated `docs/LOCKED_DECISION_LEDGER.md` from chat source import | builder | Captured requirement that location records remain editable. |
