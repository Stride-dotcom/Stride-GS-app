# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-15-LOCATIONS_CONTAINERS_UI_MODE-bc-93553291`
- Topic: Locations/Containers UI model clarification
- Topic Slug: `LOCATIONS_CONTAINERS_UI_MODE`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_UI_MODE_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-15`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `1`
- New decisions added: `DL-2026-02-15-050`
- Unresolved/open (draft): `-`
- Supersedes: `DL-2026-02-15-015`

## Decision Index Rows

| DL-2026-02-15-050 | Container/location unification uses UI-only integration while containers remain separate data entity | Containers Data Model | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_UI_MODE_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lc-001` | DL-2026-02-15-015 | - |

## Detailed Decision Entries

### DL-2026-02-15-050: Container/location unification uses UI-only integration while containers remain separate data entity
- Domain: Containers Data Model
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_UI_MODE_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lc-001`
- Supersedes: DL-2026-02-15-015
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Implement container/location unification as a **UI-layer integration** under the Locations workflow/list, while retaining containers as a separate backend entity/table. Do not migrate to `locations.type='container'` at this stage.

#### Why
This preserves existing container operations and data integrity while delivering the desired user experience of location-adjacent management without high-risk schema migration.

#### Implementation impact
- Build a locations-adjacent unified list/view that can render both location rows and container rows.
- Keep scanner/container operations backed by existing `containers`/`inventory_units` contracts.
- Keep separate Excel template/export flows for Locations and Containers.

## Implementation Log Rows

| DLE-2026-02-15-055 | 2026-02-15 | DL-2026-02-15-050 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_UI_MODE_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured explicit Option 1 decision: UI-unified Locations workflow with containers retained as separate data model. |
