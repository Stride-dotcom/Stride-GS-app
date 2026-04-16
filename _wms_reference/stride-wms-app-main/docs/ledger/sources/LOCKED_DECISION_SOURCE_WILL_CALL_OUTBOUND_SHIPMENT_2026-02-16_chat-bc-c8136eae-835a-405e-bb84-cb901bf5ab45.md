# LOCKED DECISION SOURCE: will-call-outbound-shipment
Date: 2026-02-16
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request / context

- User request (verbatim): "didn't we talk about fixing outbound shipments? we want to move will calls from a task and make it be a form of outbound shipment."

## Baseline observed in repo

- Database migration already documents the intent:
  - `supabase/migrations/20260128000000_outbound_shipments.sql`
    - Header: "Converts will call from task type to proper outbound shipment"
    - Includes a one-time migration of existing `tasks.task_type = 'Will Call'` to `shipments.shipment_type = 'outbound'`
    - Includes an optional step to deactivate `task_types.name = 'Will Call'`
- Frontend still exposed "Will Call" as a Task creation path in a few places:
  - Internal shipment detail UI offered "Will Call" in the "Create Task" dropdown.
  - Client portal "Create Task Request" offered "Will Call" as a task type.
- Internal shipment detail attempted to navigate to `/tasks/new?...` for task creation, but the router does not define a `/tasks/new` route.

## Decision delta (what we are locking in for this chat)

- Will Call is an **Outbound Shipment** workflow, not a Task workflow.
- UI must:
  - Remove "Will Call" from any Task creation selectors.
  - Provide an explicit Outbound Shipment creation path from the same contexts where users previously created a Will Call task.
  - Prevent users from re-introducing a "Will Call" Task Type via "Add New Type".

## Implementation scope touched

- `src/pages/ShipmentDetail.tsx`
- `src/components/tasks/TaskDialog.tsx`
- `src/pages/ClientTaskCreate.tsx`
- `src/hooks/useTasks.ts`

