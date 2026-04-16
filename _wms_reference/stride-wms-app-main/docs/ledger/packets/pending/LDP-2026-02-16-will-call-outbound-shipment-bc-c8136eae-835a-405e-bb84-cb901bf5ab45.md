# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-will-call-outbound-shipment-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Will Call moved from Tasks to Outbound Shipments
- Topic Slug: `WILL_CALL_OUTBOUND_SHIPMENT`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_WILL_CALL_OUTBOUND_SHIPMENT_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-012, DL-2026-02-16-013`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-012 | Will Call requests are created/managed as Outbound Shipments (remove Will Call from Task entry points) | Outbound Workflow | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_WILL_CALL_OUTBOUND_SHIPMENT_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |
| DL-2026-02-16-013 | Prevent re-introducing “Will Call” as a Task Type via Task UI tooling (guards) | Outbound Workflow | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_WILL_CALL_OUTBOUND_SHIPMENT_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-012: Will Call requests are created/managed as Outbound Shipments (remove Will Call from Task entry points)
- Domain: Outbound Workflow
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_WILL_CALL_OUTBOUND_SHIPMENT_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Will Call requests must be created and managed as Outbound Shipments (not Tasks). Remove “Will Call” from Task creation entry points and provide/route users to the Outbound shipment workflow instead.

#### Why
This matches the intended data model and prevents duplicate/conflicting operational flows.

#### Implementation impact
- UI: remove Will Call options from Task entry points and surface Outbound CTAs where Will Call used to appear.
- UI: add redirect/guard so attempts to create Will Call via Tasks route users to Outbound create.

### DL-2026-02-16-013: Prevent re-introducing “Will Call” as a Task Type via Task UI tooling (guards)
- Domain: Outbound Workflow
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_WILL_CALL_OUTBOUND_SHIPMENT_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Explicitly block “Will Call” as a selectable or creatable task type for new tasks (while allowing historical task editing to remain functional if present).

#### Why
Prevents regression where will-call operations drift back into Tasks after being moved to Outbound Shipments.

#### Implementation impact
- UI: TaskDialog must filter “Will Call” from selectable task types for new tasks and block creating a new custom task type named “Will Call”.
- Logic: avoid seeding “Will Call” back into default task types on new tenants.

## Implementation Log Rows

| DLE-2026-02-16-021 | 2026-02-16 | DL-2026-02-16-012 | completed | `src/pages/ShipmentDetail.tsx`, `src/components/tasks/TaskDialog.tsx` | builder | Removed “Will Call” from Task type dropdown, added Outbound CTA, and used TaskDialog for task creation instead of navigating to `/tasks/new`. |
| DLE-2026-02-16-022 | 2026-02-16 | DL-2026-02-16-012 | completed | `src/pages/ClientTaskCreate.tsx`, `src/pages/ClientOutboundCreate.tsx` | builder | Client portal: removed “Will Call” from task request types and added an Outbound Shipment CTA (with redirect guard if Will Call is attempted). |
| DLE-2026-02-16-023 | 2026-02-16 | DL-2026-02-16-013 | completed | `src/components/tasks/TaskDialog.tsx` | builder | Filtered “Will Call” from selectable task types for new tasks and blocked creating a new custom task type named “Will Call”. |
| DLE-2026-02-16-024 | 2026-02-16 | DL-2026-02-16-013 | completed | `src/hooks/useTasks.ts` | builder | Removed “Will Call” from default task type seeding to avoid re-introducing it on new tenants. |

