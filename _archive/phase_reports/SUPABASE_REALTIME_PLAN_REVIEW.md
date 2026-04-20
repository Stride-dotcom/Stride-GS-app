# Stride GS App — Supabase Realtime Integration Plan: Code Review
_Reviewed: 2026-04-03_
_Reviewed against: StrideAPI.gs, BatchDataContext.tsx, useTasks/useRepairs/useWillCalls, TaskDetailPanel.tsx, useDashboardSummary.ts, api.ts, supabase.ts, task-board-research.md_

---

## A. Overall Assessment

The plan's architecture is correct in direction: Supabase as a coordination layer, Apps Script as execution authority, Google Sheet write = final truth. This is the right model for this system's constraints.

However, the plan was written without knowledge of several already-existing mechanisms in the codebase that must be reconciled before implementation:

- Optimistic patches (`applyTaskPatch` / `mergeTaskPatch` / `clearTaskPatch`) with 120s auto-expiry TTL already exist in all three hooks
- Server-side idempotency already exists ("Completion Processed At" stamp + LockService in `completeTask`, "Started At" + folder URL guard in `startTask`)
- Cache invalidation is already version-based (`api_bumpSummaryVersion_`) AND key-based (`invalidateClientCache_`)
- `supabase.ts` already exists (minimal client setup, credentials in `.env`)
- Apps Script error responses are already structured: `{ error, code }`
- `getBatchSummary` already returns a per-client `errors[]` array on partial failures

The plan also underestimates the structural changes required to existing write handlers in React (every `apiPost` call needs `request_id` injection) and in Apps Script (every write handler needs a Supabase notification call at the end).

**Additionally, the plan does not address the Dashboard's core performance problem**, which is independent of Supabase realtime and should be tackled first: `getBatchSummary` opens all N client spreadsheets on every cache miss, taking ~44 seconds at 5 clients. An existing pre-built index — the Task Board sheet's `Open_Tasks`, `Open_Repairs`, and `Open_Will_Calls` tabs — eliminates this entirely. See Section J for the full design.

The failure notification requirement (user requirement #1) is the most underspecified part of the plan and is actually the most implementable item — it doesn't require full realtime subscriptions and can be built first.

**Verdict:** Approved direction, needs significant gap-filling before building. The failure notification system should be re-scoped as a simpler, standalone feature that doesn't depend on the full realtime pipeline being in place. The Task Board as Dashboard index should be implemented first as a prerequisite to the Supabase layer.

---

## B. What's Strong

**1. Hybrid confirmation model is correct.**
Keeping Apps Script as execution authority is the only safe choice. Any architecture where Supabase is treated as the source of truth for billing, task completion, or WC release before the sheet write is confirmed would risk false positives on financial operations. The plan correctly scopes Phase 1 to status changes and lightweight edits only (not billing/invoices).

**2. `gs_sync_events` table schema is solid.**
The schema covers the right fields. `entity_type + entity_id + action_type` together give enough context to reconstruct what failed. The `payload jsonb` field is critical and correctly included. `confirmed_at nullable` is correct. `error_message nullable` is correct.

**3. Idempotency via `request_id` is the right layer.**
Apps Script already has server-side idempotency (stamp-based), but a client-generated `request_id` adds a second, independent layer that lets Supabase deduplicate events and lets the UI correlate a specific user action to a specific `gs_sync_events` row. This is correct architecture.

**4. Phase scoping is right.**
Excluding invoice/billing/storage/payment from Phase 1 is correct. Those operations have multi-step server logic (lock → write → billing row → email → PDF → Drive). Any partial confirmation during that pipeline would be misleading. The plan correctly keeps them out of scope.

**5. Button disable while pending is correct.**
The plan specifies disabling the action button while pending. The codebase already does this (`setSubmitting(true)` + `disabled` prop) for the initiating user, but Supabase would extend this to other users seeing the pending state.

**6. Apps Script `UrlFetchApp` is feasible.**
Apps Script can make outbound HTTPS calls via `UrlFetchApp`. Calling Supabase REST API from Apps Script is technically straightforward. This is the correct mechanism for `notifySupabaseConfirmed_()` and `notifySupabaseFailed_()`.

---

## C. What's Missing or Incomplete

**1. No RLS policy design.**
`gs_sync_events` is multi-tenant. The plan doesn't specify Row-Level Security at all. Without RLS, any authenticated user can read all sync events for all clients. This is a security gap for a 60-client system.

Minimum required policies:
- SELECT: `auth.email() = requested_by` OR `user.role IN ('admin','staff')`
- INSERT: `auth.email() = requested_by` (React writes its own events)
- UPDATE: service role only (Apps Script writes confirmed/failed status)
- DELETE: none (keep for audit trail)

**2. No timeout / watchdog design.**
Apps Script has a 6-minute execution limit. For heavy operations (complete task with billing + email + PDF), execution could take 30-90 seconds. If Apps Script times out, the sheet write may or may not have completed, but `notifySupabaseConfirmed_()` never fires. The `gs_sync_events` row stays in `pending_sync` forever.

The plan does not specify:
- How long before a `pending_sync` is auto-promoted to `sync_failed`
- Who runs the timeout watchdog (a Supabase edge function? A React `useEffect` timer? A Postgres cron job?)
- What the UI shows after timeout vs. confirmed failure

Recommended: React-side timeout — if no Supabase event received within N seconds (e.g., 90s for heavy ops, 30s for lightweight edits), auto-display a "may have failed — check the sheet and retry if needed" warning. This doesn't require any new infrastructure.

**3. No strategy for the 120s patch TTL conflict.**
The existing patch system auto-expires patches after 120,000ms (120s). The plan implies `pending_sync` state should persist until Apps Script confirms. For a task completion that takes 45s, the patch could still be alive. But if Apps Script takes longer (rare but possible), the patch auto-expires, the UI snaps back to server data (which doesn't yet have the completed status), and then the Supabase "confirmed" event arrives to find no patch to clear.

The plan must specify: does `pending_sync` state live in the patch system or in a separate Supabase-driven state layer? If separate, the two systems need to be coordinated so they don't fight each other.

**4. No plan for confirmed → refetch coordination.**
Currently, `clearTaskPatch(taskId)` removes the optimistic data and the server data takes over on the NEXT refetch. The plan says "on confirmed → replace pending with confirmed state" but doesn't specify what triggers the refetch. The confirmed Supabase event fires, but the table still shows stale cached data until the next poll (up to 10s for Dashboard, longer for detail pages that don't poll).

The confirmed handler needs to call `refetch()` or `silentRefetchBatch()` immediately, not just clear the patch.

**5. No design for the BatchDataContext split.**
`BatchDataContext` is only active for single-client users with `role === 'client'` and `isParent === false`. Staff and admin use individual hooks (`useTasks`, `useRepairs`, `useWillCalls`) fetching independently. The Supabase subscription must work correctly for both code paths. The plan doesn't address this. Specifically: the "confirmed" event arrives and needs to trigger a refetch. For client users that means `silentRefetchBatch()`. For staff users it means calling the individual hook's `refetch()`. The subscription handler needs to know which path it's on.

**6. No Supabase Script Property setup in Apps Script.**
`notifySupabaseConfirmed_()` needs a Supabase service role key and the REST endpoint URL. These must be added as Script Properties in the StrideAPI Apps Script project:
- `SUPABASE_URL` → `"https://xxxxx.supabase.co"`
- `SUPABASE_SERVICE_KEY` → `"eyJ..."` (service role, NOT anon key)

The service role key must be used (not the anon key) because Apps Script is writing confirmed/failed status updates, which the RLS policy should only allow via service role.

**7. No definition of `tenant_id`.**
The `gs_sync_events` table has a `tenant_id` column but the plan doesn't specify what value goes there. `clientSheetId` (the Google Sheets spreadsheet ID) is the most practical — it matches how the existing system identifies clients everywhere. The plan should commit to this.

**8. Failure notification requirement is mentioned but not designed.**
The plan says the user wants failure visibility but doesn't specify the actual UI component, query, or data shape. See Section E for full design.

---

## D. Conflicts with Current Codebase

**1. `request_id` is not in `apiPost()` today.**
The plan says "attach `request_id` to Apps Script call" but the current `apiPost()` function puts auth params (`token`, `callerEmail`, `clientSheetId`) in the query string and the payload in the JSON body. There is no `request_id` field anywhere in the current implementation.

Every one of the 11+ POST helpers (`postCompleteTask`, `postStartTask`, `postCompleteRepair`, `postProcessWcRelease`, `postCancelWillCall`, `postUpdateInventoryItem`, `postRequestRepairQuote`, `postCancelTask`, `postCancelRepair`, `postUpdateTaskNotes`, `postUpdateTaskCustomPrice`) would need to be updated — OR `request_id` gets injected at the `apiPost()` level automatically (recommended: generate UUID in `apiPost` if not provided, pass as body field).

**2. Apps Script idempotency uses stamps, not `request_id`.**
`completeTask` already has a server-side idempotency mechanism: "Completion Processed At" column stamp checked inside `LockService`. `startTask` uses "Started At" + folder URL existence as its idempotency guard. Neither uses a client-provided `request_id`.

The plan adds a third idempotency layer (`gs_sync_events.request_id` dedup). This is fine but creates a question: if the React app retries a failed operation with a NEW `request_id` (correct behavior), Apps Script will still block it via the stamp check and return `{ success: true, skipped: true }`. The retry UI must handle `{ success: true, skipped: true }` as a "already done — refresh" signal, not as a new success.

**3. Step B (write to Supabase before calling Apps Script) requires restructuring all write handlers.**
The current flow in `TaskDetailPanel.callCompleteTask()` is:
1. `applyTaskPatch()` — optimistic
2. `await postCompleteTask()` — Apps Script call
3. If failure → `clearTaskPatch()` + `setSubmitError()`
4. If success → `clearTaskPatch()` + `setSubmitResult()`

The plan's flow inserts a Supabase write between steps 1 and 2. This restructuring affects every action handler in every detail panel. `TaskDetailPanel` has 3 (complete, start task, save). `RepairDetailPanel` has its own. `WillCallDetailPanel` has release + cancel. This is significant scope.

**4. The "confirmed" Supabase event arrives after `clearTaskPatch()` already ran.**
In the current flow, `clearTaskPatch()` is called immediately when Apps Script returns success. With the new plan, the Apps Script HTTP response still comes back synchronously to the React caller, but the "confirmed" Supabase event is a separate channel that arrives slightly later. The patch is already gone when the Supabase event fires. This is actually fine for the initiating user — the HTTP response already drives their state. The Supabase subscription is only needed for OTHER users who never made the HTTP call. The plan should clarify this explicitly.

**5. Apps Script `UrlFetchApp` call to Supabase is synchronous and blocking.**
If the Supabase REST call fails (network timeout, Supabase down), `notifySupabaseConfirmed_()` throws or returns an error. The correct answer: wrap in `try/catch`, log the failure, and return success from Apps Script regardless. The Supabase notification is best-effort; the Sheet write is what matters. The plan implies this but doesn't state it explicitly.

**6. `doPost` routing exists only in `RemoteAdmin.gs`, not `StrideAPI.gs`.**
All StrideAPI routing goes through `doGet()`. `notifySupabaseConfirmed_()` and `notifySupabaseFailed_()` are helper functions called at the END of existing handlers — not new routes. The plan's language could be misread as implying new routes.

**7. The optimistic patch for other users requires them to have the entity in local state.**
When user B's Supabase subscription fires and shows task INSP-12345 as `pending_sync`, user B's `useTasks` must have that task in its local state to apply the patch. If user B is on a different page and the task isn't loaded, the patch has nowhere to land.

For the Dashboard specifically (which uses `useDashboardSummary`, not `useTasks`), the patch system is entirely different — `useDashboardSummary` has its own state with no patch infrastructure at all. A Supabase event would need to either update `useDashboardSummary`'s local state directly, or trigger a refetch of `getBatchSummary`.

---

## E. Failure Notification System Design

The user's requirement: when a Google Sheet write fails, show exactly what failed (order, item, client, update type) so it can be retried manually.

**Current system gaps:**
- Failure is only shown to the initiating user via `setSubmitError()` — a local React state string that disappears when the user navigates away
- Other users never know a write failed
- No persistent record of what failed and what the payload was
- No retry mechanism — user must manually redo the entire action

**The plan's current coverage:** mentions `sync_failed` state and `error_message` in `gs_sync_events` but does not design the UI, query, or retry flow.

### Step 1 — Payload must contain enough to reconstruct the failure

Required fields in the `payload jsonb` for each action type:

```
completeTask:
  { taskId, taskType, result, taskNotes, clientName, clientSheetId,
    itemId, description, sidemark }

startTask:
  { taskId, taskType, assignedTo, clientName, clientSheetId,
    itemId, description }

completeRepair:
  { repairId, repairResult, finalAmount, clientName, clientSheetId,
    itemId, description }

processWcRelease:
  { wcNumber, releaseType, itemIds, clientName, clientSheetId,
    pickupParty }

updateTaskNotes / updateInventoryItem / field edits:
  { entityId, entityType, fields: { fieldName: newValue },
    clientName, clientSheetId }
```

### Step 2 — Write to `gs_sync_events` on failure (two paths)

**Path A — Apps Script returns `{ success: false, error: "..." }`**
(e.g., sheet not found, lock timeout, billing error):
React receives the HTTP error response and writes to `gs_sync_events` with `sync_status = 'sync_failed'`, `error_message = resp.error`, and full payload. Apps Script does NOT need to write to Supabase in this case — the React caller already knows it failed.

**Path B — Apps Script times out or network fails (no HTTP response):**
React catches the fetch error/timeout and writes `sync_failed` to Supabase with `error_message = 'Apps Script timeout or network error'`. The sheet write status is UNKNOWN in this case — the error message should say "Write may not have completed — check the sheet before retrying."

```typescript
// In each write handler's error branch (currently where clearTaskPatch + setSubmitError live):

if (!resp.ok || !resp.data?.success) {
  clearTaskPatch(taskId);
  const errorMsg = resp.error || resp.data?.error || 'Unknown error';
  setSubmitError(errorMsg);

  await supabase.from('gs_sync_events').insert({
    entity_type: 'task',
    entity_id: taskId,
    action_type: 'complete_task',
    sync_status: 'sync_failed',
    requested_by: callerEmail,
    request_id: requestId,
    tenant_id: clientSheetId,
    payload: {
      taskId, result, taskNotes, clientName, clientSheetId,
      itemId, description, sidemark
    },
    error_message: errorMsg,
  });
  return;
}
```

### Step 3 — "Failed Operations" persistent notification panel

**Component:** `<FailedOperationsDrawer />` or banner at top of page

**Query on app load and after any write:**
```typescript
supabase
  .from('gs_sync_events')
  .select('*')
  .eq('sync_status', 'sync_failed')
  .eq('requested_by', callerEmail)
  .order('created_at', { ascending: false })
  .limit(20)
```

For staff/admin: also query all `sync_failed` events (not filtered by `requested_by`) so Justin can see failures from any user.

**Display per failed event:**
- Action: "Complete Task" / "Start Task" / "Release Will Call" / etc.
- Entity: INSP-12345 (task) / WC-00123 (will call) / RPR-456 (repair)
- Client: [clientName]
- Item: [itemId] — [description]
- What changed: e.g., "Result: Pass, Notes: 'checked ok'"
- When: timestamp
- Error: `error_message` from `gs_sync_events`
- [ Retry ] button
- [ Dismiss ] button (marks as acknowledged, removes from view)

### Step 4 — Retry flow

The Retry button reads the `payload` from the `gs_sync_events` row and re-submits the original action with a NEW `request_id` (because the old one may have partially executed). The re-submit follows the normal write flow. On success, mark the original `gs_sync_events` row as `'resolved'` (add a `resolved_at` timestamp).

Critical: before retrying, check if the operation may have already completed (the Path B "unknown" case). For task completions, check the current task status first via `getBatchSummary` or a targeted refetch. If already Completed, mark the failed event as resolved without re-submitting.

### Step 5 — Notification indicator

Badge count on a sidebar bell icon or drawer toggle showing number of unacknowledged `sync_failed` events for the current user. Supabase realtime subscription on `gs_sync_events WHERE sync_status='sync_failed' AND requested_by=callerEmail` updates this count in real time.

**This failure notification system does not require the full realtime pipeline.** It can be built with:
- `gs_sync_events` table (just the schema + RLS)
- React writing to Supabase on failure (no Apps Script changes needed)
- A simple query on load for the notification panel
- A Supabase subscription for the badge count

This should be Phase 1, not Phase 2.

---

## F. Over-Engineering Concerns

**1. `pending_sync` for other users may not be worth building yet.**
The warehouse context is typically 2-5 people total using the system simultaneously. The probability that User B is watching the exact same task on the Dashboard while User A completes it is low. The 10s Dashboard polling already handles the common case (User B sees the update within 10s). Building the `pending_sync` cross-user visibility adds significant complexity for an edge case. Consider deferring to Phase 3 or later.

**2. Step B (write to Supabase before calling Apps Script) adds latency to every write action.**
Every user-initiated write currently does: `applyPatch` → `apiPost` → handle response. The plan inserts an async Supabase write before the Apps Script call, adding ~100-300ms to every write action's perceived initiation time. For a UI that's supposed to feel instant (optimistic), this is an anti-pattern.

Alternative: write to Supabase ONLY on failure. The success path doesn't need a Supabase event for the initiating user — the HTTP response already tells them it worked. The `pending_sync` event is only valuable to OTHER users, and the 10s polling already covers that adequately for the warehouse scale.

**3. Phase 4 "evaluate source-of-truth migration" should be removed.**
The Google Sheets system is explicitly a temporary system until the Stride WMS web app is ready. The Supabase source-of-truth migration question is a Phase 7+ concern for the separate React/Supabase web app project, not this system. Including it here creates confusion about project scope.

**4. Duplicate idempotency layers.**
There are now three idempotency mechanisms: (1) server-side stamp in Google Sheet ("Completion Processed At"), (2) `LockService` in Apps Script, (3) `request_id` in `gs_sync_events`. Layer 3 is valuable for failure tracking and retry dedup, but Apps Script does NOT need to check `gs_sync_events` for dedup — the existing stamp mechanism is sufficient. `gs_sync_events` `request_id` dedup is only for the React UI (don't show duplicate pending indicators for the same operation).

---

## G. Recommended Changes to the Plan

**1. Inject `request_id` at `apiPost()` level, not per handler.**
```typescript
// In api.ts apiPost():
const requestId = (body.requestId as string) ?? crypto.randomUUID();
body = { ...body, requestId };
```
This adds `request_id` to every POST automatically. Apps Script receives it via `payload.requestId` — store it for logging, but don't use it for idempotency (use existing stamps).

**2. Write to Supabase only on failure in Phase 1.**
Don't write a `pending_sync` row before the Apps Script call. This avoids latency, simplifies the flow, and still delivers the user's primary requirement: failure visibility. See Section E, Step 2 for the exact code pattern.

**3. Add Supabase Script Properties to StrideAPI.gs project.**
Required script properties (set manually in Apps Script editor):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

```javascript
function notifySupabaseFailed_(requestId, entityType, entityId,
                                actionType, errorMsg, tenantId) {
  try {
    var url = prop_("SUPABASE_URL") + "/rest/v1/gs_sync_events";
    var key = prop_("SUPABASE_SERVICE_KEY");
    if (!url || !key) return;
    UrlFetchApp.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify({
        request_id: requestId,
        entity_type: entityType,
        entity_id: entityId,
        action_type: actionType,
        sync_status: "sync_failed",
        error_message: errorMsg,
        tenant_id: tenantId
      }),
      muteHttpExceptions: true
    });
  } catch (_) {} // best-effort — never propagate
}
```

**4. Add React-side timeout watchdog (90s).**
In each action handler, if the Apps Script call is still in-flight after 90s (`AbortController` + `setTimeout`), abort the fetch and write a `sync_failed` row with `error_message = "Operation timed out — check the sheet to verify the action completed before retrying."` This covers Apps Script timeout without needing a Supabase edge function.

**5. Fix the confirmed → refetch gap.**
When Apps Script writes `'confirmed'` to Supabase and the subscription fires:
- For client users: call `silentRefetchBatch()` from `BatchDataContext`
- For staff users: call the relevant hook's `refetch()` (`useTasks`, `useRepairs`, or `useWillCalls` based on `entity_type`)
- For Dashboard: call `refetch()` on `useDashboardSummary`

**6. Add RLS policies before anything else.** (See Section H for SQL.)

**7. `tenant_id` = `clientSheetId`.**
Use the Google Sheets spreadsheet ID as `tenant_id`. It's already the primary client identifier everywhere in the system.

**8. Clarify that Apps Script notification is best-effort.**
`notifySupabaseConfirmed_()` and `notifySupabaseFailed_()` are always wrapped in `try/catch`. If Supabase is down, the Apps Script response is still returned to the React caller. The Sheet write is authoritative regardless of whether Supabase receives the notification.

---

## H. Implementation Order Recommendation

### Phase 0 — Task Board as Dashboard Index (prerequisite, before any Supabase work)

The Dashboard's `getBatchSummary` endpoint opens all N client spreadsheets on every cache miss, taking ~44 seconds at 5 clients. This is the most impactful performance problem in the system and should be fixed before adding Supabase as another coordination layer on top of a slow foundation.

The Task Board sheet already aggregates all open tasks, repairs, and will calls across all clients via its `Open_Tasks`, `Open_Repairs`, and `Open_Will_Calls` tabs. It refreshes every 5 minutes via `TB_RefreshNow()`. Reading from it takes ~1-2 seconds (one sheet open, three contiguous tab reads) regardless of how many clients exist.

**See Section J for the complete design.**

### Phase 1 — Failure Notification (no Apps Script changes required)

1. Create `gs_sync_events` table in Supabase with all columns + RLS policies
2. Add `request_id` injection to `apiPost()` in `api.ts` (one change, all POSTs)
3. Add Supabase failure write to error branches in React write handlers: `TaskDetailPanel` (complete, start, save), `RepairDetailPanel` (complete, quote, start), `WillCallDetailPanel` (release, cancel)
4. Build `<FailedOperationsDrawer />` component with query + retry + dismiss
5. Add badge count subscription to sidebar (count of user's `sync_failed` events)
6. Add 90s React-side timeout watchdog to all write handlers

**Result:** User can see exactly what failed, with full context, and retry it. No Apps Script changes. No `pending_sync` for other users. Delivers the user's stated requirement #1 completely.

### Phase 2 — Apps Script Confirmation Notifications

1. Add `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` to StrideAPI Script Properties
2. Build `notifySupabaseConfirmed_()` and `notifySupabaseFailed_()` helpers
3. Wire `notifySupabaseConfirmed_()` at the end of `handleCompleteTask_`, `handleStartTask_`, `handleCompleteRepair_`, `handleProcessWcRelease_`, `handleCancelWillCall_`, `handleRespondToRepairQuote_`
4. Wire `notifySupabaseFailed_()` in the catch block of each handler
5. Update `FailedOperationsDrawer` to deduplicate: if Apps Script fires `sync_failed` AND React already wrote `sync_failed` (from Phase 1), prefer the Apps Script event as it has higher-quality error info

**Result:** Supabase gets authoritative confirmation/failure from the source of truth, not just from the React caller's perspective.

### Phase 3 — Cross-User Realtime (pending_sync for other users)

1. Add `pending_sync` write to React BEFORE Apps Script call (restructure write handlers)
2. Build `useGsSyncEvents` hook: subscribes to `gs_sync_events` realtime
3. Wire subscription handler to apply `pending_sync` / `confirmed` / `sync_failed` state to `useDashboardSummary` and the relevant entity hook
4. Add pending indicator UI to Dashboard rows (spinner/badge on pending rows)
5. Ensure subscription handler calls correct `refetch()` path based on user role (`BatchDataContext` vs individual hooks)

### Phase 4 — Extend to Repairs and Will Calls

- Repairs: `sendRepairQuote`, `respondToRepairQuote`, `completeRepair`, `startRepair`, `cancelRepair`
- Will Calls: `createWillCall`, `processWcRelease`, `cancelWillCall`, `addItemsToWillCall`, `removeItemsFromWillCall`
- Field edits: `updateInventoryItem`, `updateTaskNotes`, `updateTaskCustomPrice`

Phase 4 is mostly mechanical repetition of Phase 3 patterns.

### RLS Policies (required before Phase 1 goes live)

```sql
-- Enable RLS
ALTER TABLE gs_sync_events ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events
CREATE POLICY "users_insert_own_events"
  ON gs_sync_events FOR INSERT
  WITH CHECK (requested_by = auth.email());

-- Users can read their own events
CREATE POLICY "users_read_own_events"
  ON gs_sync_events FOR SELECT
  USING (requested_by = auth.email());

-- Admins can read all events
CREATE POLICY "admins_read_all_events"
  ON gs_sync_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE email = auth.email() AND role IN ('admin', 'staff')
    )
  );

-- Service role can update events (Apps Script uses service key)
-- Service role bypasses RLS by default in Supabase — no policy needed
```

---

## I. Open Questions for the User

**1. How many concurrent users typically?**
If it's 2-3 people simultaneously, the cross-user `pending_sync` feature (Phase 3) may not be worth the complexity. The failure notification system (Phase 1) delivers most of the value. Do you want to confirm before committing to Phase 3?

**2. Should failure records persist across sessions?**
Phase 1 writes `sync_failed` to Supabase, which persists indefinitely. If Justin closes the browser and reopens it, he'll still see yesterday's unresolved failures. Is that the desired behavior, or should failures auto-expire after N hours?

**3. What is the acceptable timeout?**
The 90s watchdog is a guess. Some operations (complete task with billing + email + PDF on a slow day) may legitimately take 60-80s. What timeout window feels right for the warehouse context? Should it vary by action type (30s for field edits, 90s for task completions, 120s for WC release)?

**4. Who can see other users' failures?**
The RLS recommendation above lets admins and staff see all `sync_failed` events across users. Should clients only see their own? Confirm the visibility rules before writing the RLS policies.

**5. Is the Task Board trigger going to be kept running?**
The Task Board as Dashboard index (Section J) depends on `TB_RefreshNow` staying healthy. If the plan is to eventually decommission the Task Board entirely, that creates a conflict. However, if Justin still uses the Task Board directly for editing tasks, keeping the trigger running is natural and the Dashboard benefits at no extra cost.

**6. `pending_sync` for other users or just failure visibility?**
The plan conflates two separate requirements:
- (a) Failure visibility + retry (the stated requirement) — deliverable in Phase 1 in 1-2 days
- (b) Cross-user realtime pending state (the architectural ambition) — 2-3x the work

Do you want both, or just (a) for now?

---

## J. Task Board as Dashboard Index

_This section is addendum to the Supabase plan. It addresses the Dashboard's core performance problem independently of realtime notifications._

### The Problem

`getBatchSummary` in StrideAPI.gs opens every active client spreadsheet on every cache miss. At 5 clients the cold-cache response time is ~44 seconds. The 60-second CacheService TTL means this happens roughly once per minute per user. As the system grows toward 60 clients, this becomes completely untenable. Supabase realtime won't fix this — it reduces polling frequency but doesn't change what happens when a cache miss occurs.

### The Existing Solution

The Task Board sheet already has a pre-built, continuously refreshed index of all open tasks, repairs, and will calls across all clients:

- **`Open_Tasks` tab:** Client Name, Sidemark, Status, Task ID, Type, Item ID, Vendor, Description, Location, Created, Task Notes, Result, Assigned To, Completed At, Cancelled At, Item Notes, Shipment #, Svc Code, Billed, Start Task, Started At — plus system metadata columns
- **`Open_Repairs` tab:** Client Name, Sidemark, Status, Repair ID, Source Task ID, Item ID, Vendor, Description, Location, Class, Quote Amount, Approved, Repair Result, Repair Vendor, Scheduled Date, Start Date, Item Notes, Created By, Created Date — plus system metadata
- **`Open_Will_Calls` tab:** Client Name, WC Number, Status, Created Date, Pickup Party, Pickup Phone, Requested By, Estimated Pickup Date, Actual Pickup Date, Notes, COD, COD Amount, Items Count, Total WC Fee — plus system metadata

`TB_RefreshNow()` runs every 5 minutes (time-based trigger), opens all N client sheets, and writes fresh data to these three tabs. The sheet-open cost is paid in the background on the Task Board's own schedule, not on the user's request path.

Reading from the Task Board takes ~1-2 seconds: one spreadsheet open, three `getDataRange().getValues()` calls, done.

### Proposed: `handleGetBatchSummaryFromTaskBoard_()` in StrideAPI.gs

```javascript
function handleGetBatchSummaryFromTaskBoard_(callerEmail, noCache) {
  var tbId = prop_("TASK_BOARD_SPREADSHEET_ID");
  if (!tbId) return errorResponse_("TASK_BOARD_SPREADSHEET_ID not configured", "CONFIG_ERROR");

  // Check CacheService first (120s TTL — longer than current 60s because
  // the underlying data only changes every 5 min anyway)
  var cacheKey = "tbsummary:v" + api_getSummaryVersion_() + ":" + callerEmail;
  if (!noCache) {
    try {
      var cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) return ContentService.createTextOutput(cached)
                                       .setMimeType(ContentService.MimeType.JSON);
    } catch (_) {}
  }

  var ss;
  try { ss = SpreadsheetApp.openById(tbId); }
  catch (e) { return errorResponse_("Cannot open Task Board: " + e.message, "NOT_FOUND"); }

  // Resolve accessible client scope for this caller
  var scope = null;
  var lookup = lookupUser_(callerEmail);
  if (lookup.user && lookup.user.role === "client") {
    scope = getAccessibleClientScope_(lookup.user);
    if (!scope) scope = [lookup.user.clientSheetId]; // standalone client
  }
  // staff/admin: scope = null (all clients)

  var taskSheet  = ss.getSheetByName("Open_Tasks");
  var repSheet   = ss.getSheetByName("Open_Repairs");
  var wcSheet    = ss.getSheetByName("Open_Will_Calls");

  var tasks     = api_readTbTab_(taskSheet,  scope, "clientSheetId");
  var repairs   = api_readTbTab_(repSheet,   scope, "clientSheetId");
  var willCalls = api_readTbTab_(wcSheet,    scope, "clientSheetId");

  // Map to the same response shape as getBatchSummary
  // (column names differ from StrideAPI.gs internal names — use header map)
  var result = {
    tasks:     tasks.map(api_mapTbTask_),
    repairs:   repairs.map(api_mapTbRepair_),
    willCalls: willCalls.map(api_mapTbWc_),
    counts: {
      tasks:     tasks.length,
      repairs:   repairs.length,
      willCalls: willCalls.length
    },
    summaryVersion: api_getSummaryVersion_(),
    source: "taskboard",
    tbLastSync: api_getTbLastSync_(ss) // timestamp from Sync_Log tab
  };

  var json = JSON.stringify(result);
  try { CacheService.getScriptCache().put(cacheKey, json, 120); } catch (_) {}
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
```

### What Needs to Happen to Enable This

1. **Find the Task Board spreadsheet ID** from its Google Sheets URL when the sheet is open (format: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`)
2. **Add as StrideAPI Script Property:** `TASK_BOARD_SPREADSHEET_ID` = the ID from step 1
3. **Add to StrideAPI.gs `doGet()` routing:**
   ```javascript
   case "getBatchSummary":
     return withActiveUserGuard_(callerEmail, function() {
       return handleGetBatchSummaryFromTaskBoard_(callerEmail, noCache);
     });
   ```
   The `action` name stays `getBatchSummary` — the React app and `useDashboardSummary` hook don't change at all.
4. **Add `api_readTbTab_`, `api_mapTbTask_`, `api_mapTbRepair_`, `api_mapTbWc_` helpers** — these read the Task Board tab using header-based column mapping (same `getHeaderMap_()` pattern used everywhere) and return objects matching the existing `getBatchSummary` response shape

### Scope Filtering for Parent/Client Users

The `Open_Tasks` tab has a `__Client Spreadsheet ID` system column (populated by `TB_writeMirror_()`). This is the key for filtering: when `handleGetBatchSummaryFromTaskBoard_()` resolves that the caller is a client-scoped user, it filters the Task Board rows by `__Client Spreadsheet ID` against the user's accessible scope array. Staff and admin get all rows unfiltered.

### Tradeoffs

| Concern | Current `getBatchSummary` | Task Board index |
|---|---|---|
| Cold cache response time | ~44s at 5 clients | ~1-2s always |
| Data freshness | Fresh-on-write (cache busts on write) | ≤5 minutes stale |
| Sheet opens per request | N client sheets | 1 (Task Board) |
| Background cost | None | TB_RefreshNow opens N sheets every 5 min |
| Failure mode | Slow but correct | Stale if TB trigger fails |
| Dependency | None | TB_RefreshNow trigger must stay healthy |
| Implementation | Already deployed | New script property + new handler |

### Interaction with Supabase Realtime

The Task Board index and the Supabase realtime layer complement each other:

- **Task Board index** eliminates the cold-cache read problem. Dashboard loads in 1-2s always.
- **Supabase realtime** eliminates the 5-minute staleness window after a write. When a task is completed, the `confirmed` Supabase event fires and triggers an immediate refetch with `noCache=1`, which re-reads the Task Board tab (fast) and gets the latest data. The 5-minute staleness window is only visible to users who are NOT watching the Dashboard — any active Dashboard session sees the update within seconds via the realtime channel.
- Together: fast reads + near-realtime updates, with Google Sheets as the immutable source of truth.

### Staleness Mitigation

The one remaining concern is: what if the Task Board data is stale when a user loads the Dashboard for the first time after a task was just completed? Mitigation options in priority order:

1. **`api_bumpSummaryVersion_()` already exists and is called by every write.** The Task Board index uses the same version-keyed cache (`tbsummary:v{N}:...`). Any write bumps the version, orphaning the cached response. The next Dashboard load re-reads the Task Board tab (fast). This already handles most staleness for the initiating user.
2. **The 5-minute TB_RefreshNow cycle** keeps the underlying Task Board data fresh for all other users.
3. **Supabase `confirmed` event** triggers immediate `noCache` refetch on the Dashboard for any user watching at the time.

The worst case — a task completes, the Supabase notification never fires, and no other refetch is triggered — still resolves within 5 minutes when `TB_RefreshNow` next runs. This is acceptable for the warehouse operational context.

### Rollback Plan

If the Task Board index approach has problems (Task Board data quality issues, trigger failures, etc.), rolling back is a one-line change in `doGet()`: swap `handleGetBatchSummaryFromTaskBoard_` back to `handleGetBatchSummary_`. No React changes required. The fallback is always available.

---

## K. Combined Architecture Summary

With both the Task Board index and Supabase realtime in place, the full system looks like this:

```
User initiates action (complete task, start task, release WC, etc.)
  │
  ├─ React: applyTaskPatch() → optimistic UI update
  │
  ├─ React: apiPost() with auto-injected request_id
  │    │
  │    ├─ Apps Script executes: sheet write + billing + email + PDF
  │    │    │
  │    │    ├─ SUCCESS → notifySupabaseConfirmed_() [best-effort]
  │    │    │            → api_bumpSummaryVersion_()
  │    │    │            → invalidateClientCache_()
  │    │    │
  │    │    └─ FAILURE → notifySupabaseFailed_() [best-effort]
  │    │                 → return { success: false, error: "..." }
  │    │
  │    └─ HTTP response back to React
  │         │
  │         ├─ Success: clearTaskPatch() → server data on next refetch
  │         │
  │         └─ Failure: clearTaskPatch() + setSubmitError()
  │                     + supabase.insert(sync_failed event)
  │                       [with full payload for retry]
  │
  └─ Supabase realtime subscription fires for other active users
       │
       ├─ confirmed event → trigger immediate Dashboard refetch (noCache)
       │   Dashboard reads Task Board index → 1-2s response
       │
       └─ sync_failed event → badge count + notification drawer entry


Dashboard polling (every 10s):
  useDashboardSummary → getBatchSummary action
    → handleGetBatchSummaryFromTaskBoard_()
    → reads Open_Tasks / Open_Repairs / Open_Will_Calls from Task Board
    → 1-2s response always (no N-sheet opens)
    → version-keyed 120s cache

Task Board TB_RefreshNow (every 5 min, background):
  → opens all N client sheets
  → writes fresh data to Open_Tasks / Open_Repairs / Open_Will_Calls
  → pays the sheet-open cost so Dashboard never has to
```

This architecture delivers:
- ~1-2s Dashboard loads (Task Board index eliminates the 44s cold-cache problem)
- Near-realtime updates for active users (Supabase subscription triggers immediate refetch after write)
- Persistent failure visibility with retry (Phase 1 Supabase work)
- No changes to the React app's API contract (same `getBatchSummary` action name)
- Full rollback capability at every layer
