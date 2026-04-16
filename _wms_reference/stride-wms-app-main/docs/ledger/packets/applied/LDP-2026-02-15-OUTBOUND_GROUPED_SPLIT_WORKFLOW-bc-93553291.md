# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-15-OUTBOUND_GROUPED_SPLIT_WORKFLOW-bc-93553291`
- Topic: Outbound split-required workflow for grouped inventory
- Topic Slug: `OUTBOUND_GROUPED_SPLIT_WORKFLOW`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-15`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `12` (`QA-2026-02-15-027..038`)
- Existing decisions mapped: `0`
- New decisions added: `DL-2026-02-15-038..DL-2026-02-15-049`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-15-038 | Allow shipping full grouped qty without split (scan ships all N) | Outbound Operations | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-027` | - | - |
| DL-2026-02-15-039 | Partial outbound from grouped qty requires split-required workflow (client + internal) | Outbound Operations | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-028` | - | - |
| DL-2026-02-15-040 | Create split-required task + alerts immediately; client can proceed but job is blocked until split | Workflow/Tasks | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-029` | - | - |
| DL-2026-02-15-041 | Split-required work item is a high-priority Task auto-assigned to Warehouse and linked to job | Workflow/Tasks | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-030` | - | - |
| DL-2026-02-15-042 | Split-off-leftover model for partial outbound: parent qty becomes ship_qty, leftover becomes child labels | Outbound Inventory Model | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-031` | - | - |
| DL-2026-02-15-043 | Split-off-leftover outbound scanning: parent code fulfills; leftover child codes error “not this order” | Outbound Scanning | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-032` | - | - |
| DL-2026-02-15-044 | Leftover child items default to receiving location (override allowed), do not inherit container | Inventory Putaway | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-033` | - | - |
| DL-2026-02-15-045 | Split-required implementation: atomic RPC, preview exact child codes, monotonic suffixes (no reuse) | Inventory Operations | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-034` | - | - |
| DL-2026-02-15-046 | Split-required task completion requires scanning exactly N child labels; labels always reprintable | Labeling/Verification | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-035` | - | - |
| DL-2026-02-15-047 | Client portal split-required UX: prompt for notes, propagate notes to task, notify client on completion | Client Portal UX | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-036` | - | - |
| DL-2026-02-15-048 | Alert triggers/templates: split-required created vs split completed; manual-review alert type is separate | Communications/Alerts | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-037` | - | - |
| DL-2026-02-15-049 | Org toggle for client partial-from-grouped; when off, job is Pending review with manual-review alerts | Preferences/Client Portal | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-038` | - | - |

## Detailed Decision Entries

### DL-2026-02-15-038: Allow shipping full grouped qty without split (scan ships all N)
- Domain: Outbound Operations
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-027`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
If outbound shipping is for the full grouped parent quantity, allow shipping the grouped parent record as-is (no split required). Scanning the parent item code once may fulfill/ship all N units, with a clear confirmation prompt indicating that qty N will ship.

#### Why
This keeps the "ship everything in the carton" case fast and simple, while maintaining clear operator confirmation when one barcode represents multiple units.

#### Implementation impact
- Outbound fulfillment UI/scanner must support "scan once ships N" confirmation for grouped items.
- Outbound quantity logic must treat grouped items differently when the job is shipping the entire grouped quantity.

### DL-2026-02-15-039: Partial outbound from grouped qty requires split-required workflow (client + internal)
- Domain: Outbound Operations
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-028`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
If ship_qty is less than grouped_qty for a grouped parent record, do not allow shipping the partial quantity directly from the grouped parent without a split workflow. This split-required workflow can be triggered by both client portal users and internal users; internal users must follow the same warehouse split-required task workflow (no bypass / no internal toggle). Invalid split requests must be blocked and require correction.

#### Why
Partial shipping from a grouped record without a controlled split causes ambiguity and breaks traceability and floor correctness.

#### Implementation impact
- Detect grouped items (qty > 1) and enforce split-required gating when ship_qty < grouped_qty.
- Enforce validation that requested split quantity is <= (grouped_qty - 1); allow split at qty=2 (split qty=1).
- Ensure internal users cannot bypass this workflow via UI edits.

### DL-2026-02-15-040: Create split-required task + alerts immediately; client can proceed but job is blocked until split
- Domain: Workflow/Tasks
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-029`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
When a client creates/saves a job that requires a split, allow the client to proceed with job creation, but create split-required alerts immediately and block staff from starting the job until the split-required task is completed. The client should see a status indicating the job is waiting for warehouse split completion.

#### Why
Client UX must allow self-service booking while ensuring warehouse correctness and preventing downstream execution until prerequisites are completed.

#### Implementation impact
- Add "split required" gating state on jobs (outbound/task) and enforce a blocking start prompt for staff.
- Client portal should display "pending warehouse split" style status.
- Trigger split-required created notifications at job creation time.

### DL-2026-02-15-041: Split-required work item is a high-priority Task auto-assigned to Warehouse and linked to job
- Domain: Workflow/Tasks
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-030`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Represent split-required work as a Task: auto-assigned to Warehouse, default high priority, and linked to the originating job for click-through. Completing the split-required task should automatically unblock the originating job. If the originating job is canceled or changed later, do not automatically reverse the split (inventory changes stand).

#### Why
This provides a trackable, assignable operational work item with clear ownership, while avoiding risky automatic rollbacks after physical work occurred.

#### Implementation impact
- Introduce a Task type/category for split-required (or equivalent Task metadata).
- Link Task to originating job and item code and propagate notes.
- Auto-unblock job on Task completion.

### DL-2026-02-15-042: Split-off-leftover model for partial outbound: parent qty becomes ship_qty, leftover becomes child labels
- Domain: Outbound Inventory Model
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-031`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
For ship_qty < grouped_qty, use a split-off-leftover model: the parent item code remains the job item code, the parent quantity is set to ship_qty, and the leftover quantity is split into new child labels. The split-required task requested split quantity is the leftover amount (grouped_qty - ship_qty). The warehouse UI must explicitly confirm that parent qty will be set to ship_qty.

#### Why
This keeps the job referencing the original carton identity while ensuring only the leftover units get new labels when removed from the carton.

#### Implementation impact
- Split RPC must:
  - compute leftover = grouped_qty - ship_qty,
  - create leftover child item records/labels,
  - set parent qty to ship_qty.
- Split UI must show and require confirmation of before/after quantities.
- Prompt staff to review notes and verify correct item assignment post-split.

### DL-2026-02-15-043: Split-off-leftover outbound scanning: parent code fulfills; leftover child codes error “not this order”
- Domain: Outbound Scanning
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-032`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
In the split-off-leftover model, outbound fulfillment is done by scanning the parent item code on the job. Any child codes not assigned to the outbound must error "not this order."

#### Why
Only the job-scoped identity should fulfill the job; leftover items removed from the carton must not be accidentally shipped on this order.

#### Implementation impact
- Enforce "only codes on this job can be scanned" rule in outbound scan flows.
- Ensure leftover child items are not considered scannable for the originating outbound.

### DL-2026-02-15-044: Leftover child items default to receiving location (override allowed), do not inherit container
- Domain: Inventory Putaway
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-033`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Leftover child items created by split-off-leftover default to the tenant default receiving location (not inherited from the parent). The warehouse can override this target location in the split flow, and location selection does not require a location barcode scan. If the parent is in a container, leftover child items do not automatically inherit that container relationship. Split-required tasks remain valid even if the parent location changed; show current location and proceed.

#### Why
Leftover items removed from a carton often require a new handling/putaway step; defaulting to receiving supports a consistent operational funnel, while allowing override for power users.

#### Implementation impact
- Resolve tenant default receiving location for the org/warehouse.
- Split UI: allow target location override (UI select/combobox).
- Ensure leftover child items are created outside the parent container relationship unless explicitly assigned later.

### DL-2026-02-15-045: Split-required implementation: atomic RPC, preview exact child codes, monotonic suffixes (no reuse)
- Domain: Inventory Operations
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-034`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Split-required execution must be atomic (single transaction/RPC). Before committing the split, show a preview list of the exact child codes that will be created. Child codes use a monotonic suffix sequence per parent and must never be reused.

#### Why
Atomicity prevents partial state (parent qty changed but children missing). Exact preview reduces operator mistakes and improves confidence before printing/applying labels.

#### Implementation impact
- Implement split-required as a backend RPC that returns the created child codes and updated parent state.
- To support "exact preview," introduce a reservation/allocator strategy that avoids concurrent collisions while keeping preview and commit consistent.
- Enforce monotonic suffix allocation per parent code.

### DL-2026-02-15-046: Split-required task completion requires scanning exactly N child labels; labels always reprintable
- Domain: Labeling/Verification
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-035`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Labels are always reprintable without re-splitting (including multiple times over item lifecycle). Do not require audit logging for reprints. To complete a split-required task, warehouse staff must scan exactly N newly created child labels after attaching them (no partial scans / no manual override). The task must be completed in one session. Scanning the child labels is sufficient for completion (parent scan optional).

#### Why
Strong verification prevents unlabeled items after a split. Reprint flexibility supports real-world printer failures and relabel needs without forcing data changes.

#### Implementation impact
- Split task UI must track child-code scan progress and enforce exact-N completion.
- Provide a reprint action on the task/split UI that prints existing child codes without creating new ones.
- Keep completion gating strict and non-bypassable.

### DL-2026-02-15-047: Client portal split-required UX: prompt for notes, propagate notes to task, notify client on completion
- Domain: Client Portal UX
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-036`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
When a client sets ship_qty < grouped_qty, the client UI should show a split-required prompt/notice and instruct the client to add detailed notes if specific units from the carton are required. Customer notes must be included both in the client-created job and in the auto-created split-required task. On split completion, notify the client via configurable alerts and branded HTML email.

#### Why
Clients often need specific units; notes are the only reliable signal. Notification on completion reduces follow-up calls and clarifies readiness.

#### Implementation impact
- Client portal: show split-required guidance copy and capture notes.
- Carry notes through to the split-required task and originating job views.
- Add completion notification trigger and templates with tenant branding.

### DL-2026-02-15-048: Alert triggers/templates: split-required created vs split completed; manual-review alert type is separate
- Domain: Communications/Alerts
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-037`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Implement separate alert triggers for (1) split-required created (notify office/warehouse) and (2) split completed (notify client). Manual review alerts are a separate type from automated split-required. Use existing branded HTML email template styles and tokenized templates for text and in-app alerts. Split-required created alerts must include parent item code, current location, requested split qty, and job reference.

#### Why
Different stakeholders need different notifications; separating triggers makes configuration clearer and reduces template complexity.

#### Implementation impact
- Extend alert trigger registry and default templates (email/text/in-app) for each alert type.
- Ensure templates support token substitution (e.g., item code, account, job id/link, location, qty).
- Use the existing branded HTML wrapper/template for consistency.

### DL-2026-02-15-049: Org toggle for client partial-from-grouped; when off, job is Pending review with manual-review alerts
- Domain: Preferences/Client Portal
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-038`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Add an org preference toggle: allow client portal partial-qty requests from grouped parent items (which creates split-required tasks). If disabled, allow the client to submit but mark the job as "Pending review" and send manual-review alerts only (no Task). Staff can start the job; starting transitions the status out of Pending review. The job UI should include a magnifying-glass review icon and a highlighted review note explaining what needs review. Client UI should show a notice that the tenant team will review and ask for detailed notes.

#### Why
Some orgs may not want automated split-required flows via client portal. A manual review path maintains customer experience while protecting warehouse operations.

#### Implementation impact
- Add org preference storage and enforcement in client portal job creation.
- Implement "Pending review" status handling in both client and internal job UIs.
- Add manual-review alert trigger and templates (separate from split-required).
- Add UI affordances: review icon and highlighted review note content.

## Implementation Log Rows

| DLE-2026-02-15-043 | 2026-02-15 | DL-2026-02-15-038 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured outbound rule: full grouped quantity may ship as-is; scan can ship all N with confirmation. |
| DLE-2026-02-15-044 | 2026-02-15 | DL-2026-02-15-039 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured outbound rule: partial grouped shipments require split-required workflow for both client and internal users. |
| DLE-2026-02-15-045 | 2026-02-15 | DL-2026-02-15-040 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured workflow: create split-required alerts immediately; client can proceed but job start is blocked until split. |
| DLE-2026-02-15-046 | 2026-02-15 | DL-2026-02-15-041 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured split-required as Task: high priority, auto-assigned to Warehouse, linked to job, auto-unblocks on completion. |
| DLE-2026-02-15-047 | 2026-02-15 | DL-2026-02-15-042 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured split-off-leftover model for partial outbound from grouped parent quantity. |
| DLE-2026-02-15-048 | 2026-02-15 | DL-2026-02-15-043 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured outbound scanning rule: parent fulfills; leftover child codes must error not-this-order. |
| DLE-2026-02-15-049 | 2026-02-15 | DL-2026-02-15-044 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured leftover child placement: default to receiving location, allow override, no container inheritance. |
| DLE-2026-02-15-050 | 2026-02-15 | DL-2026-02-15-045 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured split-required requirements: atomic RPC and exact child-code preview with monotonic suffix allocation. |
| DLE-2026-02-15-051 | 2026-02-15 | DL-2026-02-15-046 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured label verification: scan exactly N child labels to complete split task; reprint without re-splitting. |
| DLE-2026-02-15-052 | 2026-02-15 | DL-2026-02-15-047 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured client portal split-required UX copy and note propagation requirements. |
| DLE-2026-02-15-053 | 2026-02-15 | DL-2026-02-15-048 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured alerts framework: separate split-required created vs completed triggers; manual-review alert type is separate and tokenized. |
| DLE-2026-02-15-054 | 2026-02-15 | DL-2026-02-15-049 | planned | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | builder | Captured org preference toggle and manual-review fallback behavior (Pending review) when client partial requests are disabled. |
