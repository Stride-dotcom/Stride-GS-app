# Locked Decision Source — Locations & Containers Chat Q&A (2026-02-15)

## Source metadata

- Source type: Chat transcript (this session)
- Subject: Locations page repair, location types/capacity/import-export, and container workflow/scanning
- Chat ID: `bc-93553291-7523-4d63-93a4-b47dc68b42ad`
- Compiled by: builder
- Compiled on: 2026-02-15
- Purpose: Normalize explicit Q&A decisions for ledger import

## Extraction rules used

1. Only explicit user decisions/approvals are included.
2. Duplicate statements are grouped under one Q&A record.
3. Ambiguous or unresolved points are marked as unresolved (not accepted).
4. No inferred decisions are added.

## Q&A records (explicit only)

### QA-2026-02-15-001
- Question/context: Locations page repair scope.
- Explicit answer/decision:
  - Remove the "Quick Add Bay" section from the locations UI.
  - Rename list terminology from "Bays" to "Storage Locations."
  - Show/retain usable location type data in the list and import/export flow.
  - Provide a way to input dimensions so square/cubic totals can be shown.
  - Fix/remove duplicate storage icons on location detail header.
  - Container workflows must support assigning/moving container location and cascading item location updates.

### QA-2026-02-15-002
- Question/context: Allowed location types for new use.
- Explicit answer/decision:
  - "Yes but only list aisle, bay, shelf, bin, dock, area."
  - "We will be creating a separate column later called zone used for grouping locations together."

### QA-2026-02-15-003
- Question/context: Export behavior.
- Explicit answer/decision:
  - "Make the Export button download Excel (.xlsx) with the same synced column system."

### QA-2026-02-15-004
- Question/context: Import regressions after export/type changes.
- Explicit answer/decision:
  - Legacy area/zone-style codes must not default to bin during type inference.
  - Archived exports must re-import as archived/inactive (not active).

### QA-2026-02-15-005
- Question/context: Working method before additional Q&A.
- Explicit answer/decision:
  - "First review these documents and then let’s continue the Q&A."

### QA-2026-02-15-006
- Question/context: Container use case clarification (receiving and warehouse movement).
- Explicit answer/decision:
  - Containers are used to group multiple item-coded units.
  - Moving a container should update each contained item's location automatically.
  - Container-level movement is required to avoid manual per-item moves.

### QA-2026-02-15-007
- Question/context: Scan flow for putting existing items into containers.
- Explicit answer/decision:
  - Operational scan sequence should be item scan followed by container scan to move item into container.

### QA-2026-02-15-008
- Question/context: Location representation for items in containers.
- Explicit answer/decision:
  - Candidate display format proposed: `ParentLocation (ContainerCode)` (example `A1.2E (CNT-123)`).
  - Alternate two-column approach was also discussed.
- Status: unresolved (no final selection explicitly approved).

### QA-2026-02-15-009
- Question/context: Conversation reset.
- Explicit answer/decision:
  - "Let’s back up and start over at question 1 regarding containers. Ask me questions one at a time."

### QA-2026-02-15-010
- Question/context: Container model details (proposal for confirmation).
- Explicit answer/decision:
  - Proposed model states container is a movable storage sub-location with:
    - Auto-assigned editable code (example `CNT-123`),
    - Required starting warehouse location,
    - Item scan then container scan to assign containment,
    - Container move scan updates container location and cascades item location updates.
  - Proposal included "location type = container" as scanner-recognized type.
- Status: unresolved/needs final confirmation.

### QA-2026-02-15-011
- Question/context: Parent location hierarchy in locations form.
- Explicit answer/decision:
  - Remove parent location from UI for location add/edit.

### QA-2026-02-15-012
- Question/context: Existing parent location data handling.
- Explicit answer/decision:
  - "Delete and clear. It’s never been used so no data will be lost."

### QA-2026-02-15-013
- Question/context: Selector UX for default inbound/outbound locations.
- Explicit answer/decision:
  - Selector behavior should be: click to open full list, type to filter, choose matching location.
  - Search keys should include both code and name.

### QA-2026-02-15-014
- Question/context: Where container creation/management belongs in UI.
- Explicit answer/decision:
  - Container creation should not be nested under item detail.
  - Containers should be treated as location-adjacent sub-location management.

### QA-2026-02-15-015
- Question/context: Container scanning behavior in stocktake/outbound.
- Explicit answer/decision:
  - Container scanning in stocktake and outbound should be available as a controlled bulk shortcut.
  - This behavior should be controlled by organization preference toggles.

### QA-2026-02-15-016
- Question/context: Location record management behavior.
- Explicit answer/decision:
  - Existing locations need to be editable.

### QA-2026-02-15-017
- Question/context: Intake behavior when one physical box contains multiple units.
- Explicit answer/decision:
  - User has two intake options:
    - Enter one line with quantity (example qty 4) and keep it as one grouped line with one item code.
    - Enter four separate lines and apply four labels to the same box.
  - Container label may be created later by user if needed.
  - Container creation/labeling should not be automated in this intake scenario.

### QA-2026-02-15-018
- Question/context: Grouped intake semantics and follow-up workflow.
- Explicit answer/decision:
  - For grouped single-line intake, use grouped inventory semantics (Option A): one item code representing quantity N.
  - A split-and-relabel workflow is required for later conversion from grouped to individual labels.

### QA-2026-02-15-019
- Question/context: Split/relabel behavior for original grouped code.
- Explicit answer/decision:
  - Use Option B (partial split model): keep original grouped code for remaining quantity and generate new individual codes only for split quantity.

### QA-2026-02-15-020
- Question/context: Allowed split amount behavior.
- Explicit answer/decision:
  - Use Option A: allow split quantity from 1..remaining quantity and permit repeated partial splits over time.

### QA-2026-02-15-021
- Question/context: Child code format for split/relabel output.
- Explicit answer/decision:
  - Use Option B: child split item codes should be parent-derived (example pattern similar to `PARENT-1`, `PARENT-2`) for visual traceability.

### QA-2026-02-15-022
- Question/context: Parent end-state and split guardrails.
- Explicit answer/decision:
  - If parent record reaches zero state, use archive/inactive behavior (not delete).
  - Split operation must never allow splitting the last remaining unit; at least one unit must stay attached to original parent item code.
  - All split operations must be recorded in activity/history audit trail.

### QA-2026-02-15-023
- Question/context: Label-print timing after split/relabel.
- Explicit answer/decision:
  - Use Option A: auto-print all newly generated child labels immediately after split.

### QA-2026-02-15-024
- Question/context: Child-code suffix style for parent-derived split labels.
- Explicit answer/decision:
  - Use Option B: simple non-padded suffix sequence (example: `PARENT-1`, `PARENT-2`).

### QA-2026-02-15-025
- Question/context: Location assignment for new child units created by a split/relabel.
- Explicit answer/decision:
  - Use Option A: default new child units to the parent's current location/container assignment.
  - Show a warning/confirmation that child location will be set to the current location and users should scan to update if a different location is needed.

### QA-2026-02-15-026
- Question/context: Outbound behavior when inventory remains in grouped parent record (qty > 1).
- Explicit answer/decision:
  - Use Option B: do not allow shipping a partial quantity directly from grouped parent; require split & relabel first so shipped units have their own labels.

### QA-2026-02-15-027
- Question/context: Outbound shipping when grouped parent qty is shipped in full.
- Explicit answer/decision:
  - Allow shipping the entire grouped parent quantity as-is (no split required).
  - Scanning the grouped parent code once may fulfill/ship all N units (with a clear confirmation that qty N will ship).

### QA-2026-02-15-028
- Question/context: Outbound shipping when client/internal requests a partial quantity from a grouped parent (ship_qty < grouped_qty).
- Explicit answer/decision:
  - Partial outbound from grouped parent requires a split workflow (no direct partial decrement from the grouped parent without split).
  - Split-required workflow can be triggered by both client portal users and internal users.
  - Even when internal users trigger it, follow the same warehouse split-required task workflow (no bypass / no internal toggle).
  - Requested split quantity must be valid; if invalid (e.g., requests all units), block and require correction.
  - Allow split when grouped qty is 2 (split qty=1 is valid).

### QA-2026-02-15-029
- Question/context: When and how split-required workflow is created for client requests.
- Explicit answer/decision:
  - Client can save/proceed creating the outbound/task even when split is required.
  - Create the split-required alert immediately when the client saves/creates the job (not only when staff starts it).
  - When staff attempts to start the job, show a blocking warning that split must be completed before starting.
  - Client can see a status indicating the job is waiting on warehouse split completion.

### QA-2026-02-15-030
- Question/context: Trackable work item for split-required and assignment defaults.
- Explicit answer/decision:
  - Create a trackable work item for split-required as a Task.
  - Auto-assign to Warehouse and default to high priority (SLA) because it blocks the job.
  - Task should link/reference the originating job for click-through.
  - Completing the split-required task should automatically unblock the originating job.
  - If job is later canceled/changed, the split stands; no automatic reversal.

### QA-2026-02-15-031
- Question/context: What warehouse staff actually does for partial outbound from grouped parent (split model).
- Explicit answer/decision:
  - Use a "split-off-leftover" model:
    - The parent item code remains the job item code.
    - Warehouse splits off the leftover quantity into new child labels.
    - Parent quantity is set to the ship quantity (explicitly confirm this in the UI).
  - The split-required task requested split quantity is the leftover amount (grouped_qty - ship_qty).
  - Prompt warehouse/tenant users to verify correct item assignment and review any notes after split.

### QA-2026-02-15-032
- Question/context: Outbound scanning validation for split-off-leftover model.
- Explicit answer/decision:
  - Only item codes assigned to the outbound order can be scanned successfully.
  - In this model, the outbound is fulfilled by scanning the parent item code.
  - Any child codes not on the outbound must error "not this order."

### QA-2026-02-15-033
- Question/context: Default location/container handling for leftover child items created by split-off-leftover.
- Explicit answer/decision:
  - Default leftover child items' location to tenant default receiving location (not inherited from parent).
  - Allow warehouse to override the leftover child target location in the split flow (no location scan required).
  - Do not automatically place leftover child items into the parent's container (if any).
  - Still allow split-required task even if the parent location changed since request; show current location and proceed.

### QA-2026-02-15-034
- Question/context: Atomicity and child-code generation behavior for split-required.
- Explicit answer/decision:
  - Split operation must be atomic (single transaction/RPC).
  - Show a preview list of the exact new child codes before committing.
  - Do not reuse child suffix numbers (monotonic sequence); item codes are sequential and never reused.

### QA-2026-02-15-035
- Question/context: Label printing, verification, and task completion for split-required.
- Explicit answer/decision:
  - Labels can always be reprinted multiple times; allow reprint without re-splitting.
  - Do not require audit logging for label reprints.
  - To complete split-required task, require scanning each newly created child label after attaching.
  - Enforce scanning exactly N child labels (no partial scans / no manual override).
  - Task must be completed in one session (no partial-progress resume).
  - Child-label scans alone are sufficient for completion (parent scan is optional).

### QA-2026-02-15-036
- Question/context: Client portal prompt/notes behavior for split-required.
- Explicit answer/decision:
  - Client UI does not need extra confirmation beyond setting ship quantity, but must show a prompt/notice that split is required.
  - Prompt must instruct client: if they need specific items/units from the carton, add details in notes.
  - Customer notes must carry into both the client-created job and the auto-created split-required task.
  - On split completion, notify client using an alert trigger and branded HTML email template; org can enable/disable.

### QA-2026-02-15-037
- Question/context: Alerts/templates for automated split-required vs manual-review.
- Explicit answer/decision:
  - Use separate alert triggers for:
    - Split-required created (notify office/warehouse).
    - Split completed (notify client).
  - Manual review alerts are a separate type from automated split-required.
  - Use existing branded HTML email template styles and tokenized text/in-app templates (example tokens like `[[task_type]]`, `[[item_code]]`, `[[account_name]]`).
  - For split-required created alerts, include parent item code, current location, requested split qty, and outbound/task reference.

### QA-2026-02-15-038
- Question/context: Org toggle behavior when client partial-from-grouped requests are disabled.
- Explicit answer/decision:
  - Provide an org preference toggle: allow client portal partial-qty requests from grouped parent items (creates split-required task).
  - If disabled, allow client to submit but mark job as "Pending review" (manual review flow).
  - Manual review flow uses alerts only (no Task).
  - Staff can start the job; starting transitions status out of Pending review.
  - Show a magnifying-glass (review) icon by the job title indicating needs review and add a highlighted review note explaining what needs review (example: "client requested 2 of 4 from ITM-...; please review and split accordingly").
  - Client-facing pop/notice should explain the `tenant_name` team will review and ask for detailed notes to help process the request.

## Notes

- This source is not marked authoritative/final; imported decisions should default to `accepted` when explicit and unambiguous, or `draft` when unresolved/conflicting.
