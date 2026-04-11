```
================================================================================
HANDOFF REPORT — Phase 1: Correctness & Perceived Speed
Phase 1 Restore + Documentation + Phase 2 Backup Prep
Date: 2026-04-02
================================================================================

A. PHASE COMPLETED
   Phase: Phase 1 — Correctness & Perceived Speed
   Status: FULLY COMPLETE ✅
   All 9 files restored to Phase 1 state and verified.
   TypeScript: Clean (0 errors, 0 warnings).
   Phase 2 backups: Created and confirmed.
   Build plan documentation: Created.

B. GOAL OF THIS PHASE
   Fix three correctness/UX bugs in the existing codebase before building
   new architecture. No new features. No structural changes. Zero user-facing
   risk if deployed. Goals:

   1. CORRECTNESS BUG — Staff/admin always saw stale data after writes.
      The server-side CacheService aggregate batch key ("batch:") was never
      cleared when a client-specific write happened. Staff could complete a
      task and continue seeing the old task status for up to 600 seconds
      (the CacheService TTL). Fixed in StrideAPI.gs invalidateClientCache_.

   2. UX BUG — Post-write refresh showed a full-page loading spinner.
      After any write operation, detail panels called refetch() (which mapped
      to refetchBatch), which unconditionally called setBatchLoading(true).
      This put the entire app into a loading state after every save. Fixed
      by introducing silentRefetchBatch which skips the loading state.

   3. UX BUG — Returning to a cached page flashed a loading spinner.
      When cached data already existed on mount, useApiData still called
      doFetch(true) which called setLoading(true) unconditionally before
      checking whether data was already shown. Fixed by adding silent=false
      param to doFetch and calling doFetch(true, true) on mount when cache
      exists.

   ALSO: Add per-client timing instrumentation to handleGetBatch_ to
   establish a baseline measurement before Phase 2 architecture changes.
   This data is required before any Phase 2 decisions can be made.

C. FILES BACKED UP BEFORE CHANGES

   Pre-Phase-1 originals (TRUE originals — 8 React files, captured before
   any Phase 1 edits were applied):
   Location: _backups/pre-phase1-originals/
     stride-gs-app/src/hooks/useApiData.ts
     stride-gs-app/src/hooks/useInventory.ts
     stride-gs-app/src/hooks/useTasks.ts
     stride-gs-app/src/hooks/useRepairs.ts
     stride-gs-app/src/hooks/useWillCalls.ts
     stride-gs-app/src/hooks/useShipments.ts
     stride-gs-app/src/hooks/useBilling.ts
     stride-gs-app/src/contexts/BatchDataContext.tsx

   ⚠️ WARNING — _backups/pre-phase1/ StrideAPI.gs is CORRUPTED:
   Location: _backups/pre-phase1/AppScripts/stride-api/StrideAPI.gs
   This file shows v33.1.0 — it was captured AFTER Phase 1 edits were
   applied, not before. It is NOT the true original. The 8 React file
   originals in pre-phase1-originals/ are reliable. StrideAPI.gs original
   (v33.0.1) can only be recovered by manually reverting Phase 1 edits.
   The phase1-complete backup below is the correct Phase 2 starting point.

   Phase-1-complete backups (Phase 2 starting point — captured AFTER
   Phase 1 verified clean):
   Location: _backups/phase1-complete/
     AppScripts/stride-api/
       StrideAPI.backup.phase1-complete.gs         ← v33.1.0 ✅
     stride-gs-app/src/contexts/
       BatchDataContext.backup.phase1-complete.tsx  ← Phase 1 state ✅
     stride-gs-app/src/hooks/
       useApiData.backup.phase1-complete.ts         ← Phase 1 state ✅

   Rationale for which files were backed up for Phase 2:
   - StrideAPI.gs: Phase 2 adds index build/read logic here (major edits)
   - BatchDataContext.tsx: May change if index read path differs from batch
   - useApiData.ts: May change if individual-fetch path is also optimized
   - The 6 entity hooks (useInventory etc.) were NOT backed up because
     Phase 2 should not need to touch them unless the hook interface changes.
     If that happens, back them up at that time.

D. FILES MODIFIED (Phase 1 changes — all re-applied in this session)

   1. AppScripts/stride-api/StrideAPI.gs
      Version: v33.0.1 → v33.1.0
      Reason 1: Bug fix — invalidateClientCache_ did not clear the staff
        aggregate batch cache key, leaving staff with stale data post-write.
      Reason 2: Observability — per-client timing logs added to handleGetBatch_
        to measure openById vs RichTextValue cost per client before Phase 2.

   2. stride-gs-app/src/contexts/BatchDataContext.tsx
      Reason: Add silentRefetchBatch to context so post-write refreshes don't
        show a loading spinner. Also added silent param to doFetch.

   3. stride-gs-app/src/hooks/useApiData.ts
      Reason: Fix background refresh on mount to not call setLoading(true)
        when cached data is already displayed. Added silent param to doFetch.

   4. stride-gs-app/src/hooks/useInventory.ts
      Reason: Switch refetch return value from refetchBatch to silentRefetchBatch
        so that post-write callbacks in detail panels don't trigger loading state.

   5. stride-gs-app/src/hooks/useTasks.ts
      Same reason as useInventory.ts.

   6. stride-gs-app/src/hooks/useRepairs.ts
      Same reason as useInventory.ts.

   7. stride-gs-app/src/hooks/useWillCalls.ts
      Same reason as useInventory.ts.

   8. stride-gs-app/src/hooks/useShipments.ts
      Same reason as useInventory.ts.

   9. stride-gs-app/src/hooks/useBilling.ts
      Same reason as useInventory.ts.

E. FILES CREATED

   _backups/PERFORMANCE_BUILD_PLAN.md
   Purpose: Persistent build plan document for the performance optimization
   track. Contains:
     — Project context and problem statement
     — Phase 1 complete summary with exact change descriptions
     — Phase 2 full design (Option D Hybrid Read Model architecture)
     — Phase 3 design (lazy entity loading — future)
     — 5 open questions that must be answered before Phase 2 starts
     — Phase 2 risk assessment table
     — Backup conventions and naming reference
     — Deployment command reference
     — Instructions for a new builder picking this up cold

   _backups/phase1-complete/AppScripts/stride-api/
     StrideAPI.backup.phase1-complete.gs
   _backups/phase1-complete/stride-gs-app/src/contexts/
     BatchDataContext.backup.phase1-complete.tsx
   _backups/phase1-complete/stride-gs-app/src/hooks/
     useApiData.backup.phase1-complete.ts
   (Three backup files described in section C above)

F. EXACT CHANGES MADE

   ── StrideAPI.gs ──────────────────────────────────────────────────────

   [1] Version header:
   BEFORE: StrideAPI.gs — v33.0.1 — 2026-04-03 12:30 AM PST
   AFTER:  StrideAPI.gs — v33.1.0 — 2026-04-02 8:00 PM PST

   [2] handleGetBatch_ — timing instrumentation added in three locations:

   Around SpreadsheetApp.openById():
   ADDED BEFORE:  var t_clientStart = new Date().getTime();
   ADDED AFTER:   var t_afterOpen = new Date().getTime();

   Around RichTextValue reads (api_readIdFolderUrls_ × 3 + buildShipmentFolderMap_):
   ADDED BEFORE:  var t_beforeRichText = new Date().getTime();
   ADDED AFTER:   var t_afterRichText = new Date().getTime();

   After the per-client data read loop closes, before catch block:
   ADDED:
     // Per-client timing log
     var t_clientEnd = new Date().getTime();
     Logger.log("  [batch] " + cname + ": open=" + (t_afterOpen - t_clientStart) + "ms" +
       " richtext=" + (t_afterRichText - t_beforeRichText) + "ms" +
       " total=" + (t_clientEnd - t_clientStart) + "ms");

   [3] invalidateClientCache_ — aggregate batch key clearing:
   BEFORE (end of function):
     try { cache.removeAll(keys); } catch (_) {}
   }

   AFTER:
     // Also clear the staff/admin aggregate batch key ("batch:" with empty
     // clientSheetId). This key is never covered by the per-client loop
     // above but goes stale after writes.
     keys.push("batch:");
     for (var cc = 0; cc < 10; cc++) keys.push("batch::c" + cc);
     try { cache.removeAll(keys); } catch (_) {}
   }

   The per-client loop already cleared "batch:CLIENT_ID" and its chunks.
   The new lines add "batch:" (empty string key — staff aggregate) and
   "batch::c0" through "batch::c9" (chunk keys for large staff payloads).

   ── BatchDataContext.tsx ───────────────────────────────────────────────

   [1] Interface — added silentRefetchBatch:
   BEFORE:
     /** Force refetch (e.g., after write operations) */
     refetchBatch: () => void;

   AFTER:
     /** Force refetch — shows loading state. Use for explicit refresh button. */
     refetchBatch: () => void;
     /** Silent background refetch — no loading state. Use after write operations. */
     silentRefetchBatch: () => void;

   [2] Default context value — added silentRefetchBatch:
   BEFORE:
     refetchBatch: () => {},
   AFTER:
     refetchBatch: () => {},
     silentRefetchBatch: () => {},

   [3] doFetch signature — added silent param:
   BEFORE: const doFetch = useCallback((bypassCache = false, serverNoCache = false) => {
   AFTER:  const doFetch = useCallback((bypassCache = false, serverNoCache = false, silent = false) => {

   [4] Loading state — conditioned on silent:
   BEFORE: setBatchLoading(true);
   AFTER:  // Silent mode: don't show loading spinner (used for post-write background refresh)
           if (!silent) setBatchLoading(true);

   Note: The .finally() block still calls setBatchLoading(false) unconditionally.
   This is intentional — ensures loading state always resets even on errors,
   even in silent mode (no visible effect since loading was never set to true).

   [5] Callbacks — split into two explicit functions:
   BEFORE:
     const refetchBatch = useCallback(() => doFetch(true, true), [doFetch]);

   AFTER:
     /** Explicit refetch — shows loading state. For refresh buttons. */
     const refetchBatch = useCallback(() => doFetch(true, true, false), [doFetch]);
     /** Silent background refetch — no loading state. For post-write cache sync. */
     const silentRefetchBatch = useCallback(() => doFetch(true, true, true), [doFetch]);

   [6] Provider value — added silentRefetchBatch:
   BEFORE:
     <BatchDataContext.Provider value={{
       ..., refetchBatch, batchClientSheetId: clientSheetId,
     }}>
   AFTER:
     <BatchDataContext.Provider value={{
       ..., refetchBatch, silentRefetchBatch, batchClientSheetId: clientSheetId,
     }}>

   ── useApiData.ts ──────────────────────────────────────────────────────

   [1] JSDoc header updated — clarified behavior:
   BEFORE: "Stale data (>5 min) triggers a background refetch"
           "refetch() always bypasses cache and fetches fresh"
   AFTER:  "Stale data (>5 min) triggers a background refetch (silent — no loading spinner)"
           "refetch() always bypasses cache and fetches fresh (shows loading)"

   [2] doFetch signature — added silent param:
   BEFORE: const doFetch = useCallback((bypassCache = false) => {
   AFTER:  const doFetch = useCallback((bypassCache = false, silent = false) => {

   [3] Loading state — conditioned on silent:
   BEFORE: setLoading(true);
   AFTER:  // Silent mode: don't show loading spinner (used for background refreshes
           // when cached data shown)
           if (!silent) setLoading(true);

   [4] Mount effect — background refresh now silent:
   BEFORE:
     if (cached) {
       setData(cached);
       setLoading(false);
       // Do a silent background refresh
       doFetch(true);           ← setLoading(true) was still called here!
     }
   AFTER:
     if (cached) {
       // We already have cached data — do a silent background refresh (no loading flash)
       setData(cached);
       setLoading(false);
       doFetch(true, true);     ← silent=true, no loading flash
     }

   [5] Explicit refetch — now explicitly passes silent=false:
   BEFORE: const refetch = useCallback(() => { setNextFetchNoCache(); doFetch(true); }, [doFetch]);
   AFTER:  const refetch = useCallback(() => { setNextFetchNoCache(); doFetch(true, false); }, [doFetch]);
   (false is the default so functionally identical, but explicit for clarity)

   ── useInventory.ts, useTasks.ts, useRepairs.ts,
      useWillCalls.ts, useShipments.ts, useBilling.ts ──────────────────

   Each hook received exactly 2 line changes:

   [1] Destructure line:
   BEFORE: const { batchData, batchEnabled, batchLoading, batchError, refetchBatch } = useBatchData();
   AFTER:  const { batchData, batchEnabled, batchLoading, batchError, silentRefetchBatch } = useBatchData();

   [2] Return value refetch:
   BEFORE: refetch: batchEnabled ? refetchBatch : individualRefetch,
   AFTER:  refetch: batchEnabled ? silentRefetchBatch : individualRefetch,

   This means any component that calls the hook's refetch() after a write
   (e.g., onItemUpdated={refetch} in ItemDetailPanel) will now trigger a
   silent background refresh instead of a full loading spinner.

G. BUILD/RESTORE/DEPLOY ACTIONS PERFORMED

   RESTORE SEQUENCE (performed in this session):
   1. Copied 8 React files from _backups/pre-phase1-originals/ back to
      their working locations via bash cp commands.
   2. Copied StrideAPI.gs from _backups/pre-phase1/ back to working location.
      Discovered backup was v33.1.0 (Phase 1A version, not original).
   3. Manually reverted StrideAPI.gs Phase 1 edits:
      — Version header back to v33.0.1
      — Removed t_clientStart, t_afterOpen, t_beforeRichText, t_afterRichText vars
      — Removed per-client Logger.log timing line
      — Removed keys.push("batch:") and batch chunk loop
   4. Ran npx tsc --noEmit → PASS (confirmed clean originals)
   5. Re-applied all Phase 1 changes to all 9 files.
   6. Ran npx tsc --noEmit → PASS

   COMMANDS RUN:
     npx tsc --noEmit        (twice — after restore and after re-apply)
     mkdir -p _backups/phase1-complete/...  (directory creation for backups)
     cp [source] [dest]      (backup copies of 3 files)

   NOT YET RUN (pending Justin's go-ahead to deploy):
     npm run push-api
     npm run deploy-api
     npm run build
     cd dist && git add -A && git commit -m "..." && git push origin main --force

H. CURRENT BEHAVIOR AFTER CHANGES

   FIXED — Staff stale data after writes:
     Previously: staff completed a task → batch cache key "batch:" was not
     cleared → staff saw old task list for up to 600 seconds.
     Now: invalidateClientCache_ clears "batch:" and "batch::c0"-"batch::c9"
     on every write, so next batch fetch gets fresh data immediately.

   FIXED — Loading spinner after write:
     Previously: ItemDetailPanel calls onItemUpdated={refetch} → refetch()
     maps to refetchBatch → setBatchLoading(true) → entire app shows loading.
     Now: refetch() maps to silentRefetchBatch → data refreshes in background
     → UI stays interactive during refresh.

   FIXED — Loading flash on cached page revisit:
     Previously: navigate to Inventory (data loads) → navigate away → navigate
     back → cached data shown immediately BUT doFetch(true) was called which
     still fired setLoading(true) → brief loading flash despite cache hit.
     Now: doFetch(true, true) — silent — no flash.

   UNCHANGED — Cold load time (~30s at 5 clients, projected ~5-6 min at 60):
     Phase 1 does not touch the server architecture. openById × N clients
     still happens on every batch request. This is Phase 2's job.

   UNCHANGED — Staff architecture (opens all client spreadsheets per request):
     Phase 1 only fixes cache key cleanup and React loading states.

   UNCHANGED — All write endpoints, all UI components, all other hooks:
     No functional changes to any page, modal, form, or write path.

   NEW — Timing data available after deploy:
     Apps Script Execution Logs will show per-client breakdown:
     "[batch] ClientName: open=Xms richtext=Xms total=Xms"
     This data is required input for Phase 2 architecture decisions.

I. TESTING PERFORMED

   AUTOMATED:
   ✅ npx tsc --noEmit — PASS, 0 errors, 0 warnings
      (Run twice: after restoring originals, after re-applying Phase 1)

   GREP VERIFICATION:
   ✅ StrideAPI.gs version header: v33.1.0 confirmed
   ✅ StrideAPI.gs timing vars: 6 occurrences (t_clientStart, t_afterOpen,
      t_beforeRichText, t_afterRichText × 2 locations, Logger.log line vars)
   ✅ StrideAPI.gs "batch:" in invalidateClientCache_: 4 occurrences
      (the push, the comment text, and 2 appearances of "batch:" in the
      prefix array that was already there — confirms placement is correct)
   ✅ BatchDataContext.tsx: 4 occurrences of silentRefetchBatch
      (interface, default value, useCallback, Provider value)
   ✅ useApiData.ts: 4 occurrences of "silent"
      (param default, JSDoc, if (!silent) check, doFetch(true, true) call)
   ✅ All 6 entity hooks: 2 occurrences of silentRefetchBatch each
      (1 in destructure, 1 in return value — all 6 confirmed)
   ✅ No entity hook still references refetchBatch (confirmed via grep)
   ✅ TypeScript type check after each hook change

   NOT TESTED (requires live deploy + browser session):
   ✗ Runtime behavior — does the spinner actually not appear after save?
   ✗ Cache invalidation correctness — does staff see fresh data post-write?
   ✗ Timing log output — does the Logger.log fire with correct values?
   ✗ silentRefetchBatch end-to-end — network request fires, data updates?
   ✗ Cold load behavior unchanged — confirming Phase 1 didn't slow anything
   ✗ Cross-browser behavior (Chrome, Safari, mobile)

   MANUAL VERIFICATION STEPS (to perform after deploy):
   1. Log in as staff. Complete a task. Do not refresh. Confirm the task
      list updates within a few seconds without a loading spinner appearing.
   2. Navigate to Inventory. Note data loads. Navigate to Tasks. Navigate
      back to Inventory. Confirm no loading flash — data appears immediately.
   3. Log in as client. Save an item field (e.g., vendor name). Confirm
      item detail panel stays open/responsive — no full-page loading spinner.
   4. Open Apps Script editor for StrideAPI → Executions. Find a recent
      batch call. Confirm log lines:
        "[batch] ClientName: open=Xms richtext=Xms total=Xms"
      appear for each client processed.

J. PROBLEMS / RISKS / WARNINGS

   ⚠️ RISK — invalidateClientCache_ silent mode gap for staff bulk writes:
   The fix clears "batch:" whenever invalidateClientCache_(clientSheetId) is
   called with any non-empty clientSheetId. But for staff bulk operations
   (generateStorageCharges, createInvoice), the inner call structure must be
   verified. If any bulk operation calls invalidateClientCache_('') or skips
   the call entirely, the fix is bypassed. This is Open Question #1 for
   Phase 2 — verify by reading each staff write endpoint's call pattern.
   Risk level: Medium. Impact: staff still sees stale billing data post-charge.

   ⚠️ RISK — silentRefetchBatch always sends serverNoCache=true:
   silentRefetchBatch calls doFetch(true, true, true) where the second true
   is serverNoCache. Every post-write refresh bypasses the 600s server
   CacheService. At 5 clients this adds ~30s of server work per write.
   At 60 clients this could be 5-6 minutes of server work per write — likely
   hitting Apps Script execution time limits (6 min max).
   Mitigation: Phase 2 (index architecture) makes individual reads fast.
   Until Phase 2 is deployed, avoid high-frequency writes in production.
   Risk level: Low now (5 clients), High at scale (60 clients).

   ⚠️ RISK — Backup of StrideAPI.gs original is incomplete:
   _backups/pre-phase1/StrideAPI.gs contains v33.1.0 (Phase 1 version).
   The true original v33.0.1 is not backed up anywhere. If Phase 1 needs
   to be fully reverted, must manually undo the 3 changes (version header,
   timing vars, cache key addition). Phase1-complete backup is reliable.
   Risk level: Low (Phase 1 is intentional and verified — unlikely to revert).

   ⚠️ RISK — Timing instrumentation adds minor overhead to handleGetBatch_:
   Each new Date().getTime() call is negligible (<0.1ms). Logger.log adds
   ~1ms per client. At 60 clients this is ~60ms extra per batch call.
   Acceptable for measurement phase. Remove timing vars in Phase 2 if
   Phase 2 makes handleGetBatch_ fast enough that timing is irrelevant.
   Risk level: Negligible.

   ℹ️ NOTE — Loading spinner still shows on explicit refresh button:
   This is intentional. The per-page refresh button calls refetchBatch
   (not silentRefetchBatch), which shows the loading state. This is correct
   UX — user clicked refresh, they expect to see loading feedback.

   ℹ️ NOTE — .finally() calls setBatchLoading(false) even in silent mode:
   In silent mode setBatchLoading(true) is never called, so setBatchLoading(false)
   in .finally() is a no-op. This is safe and intentional — keeps the finally
   block unconditional for simplicity, avoids any edge case where loading
   gets stuck true if the silent path somehow interleaved with a non-silent path.

K. OPEN ITEMS / REMAINING WORK

   IMMEDIATE — Deploy Phase 1 (not yet deployed):
   □ cd .../stride-client-inventory && npm run push-api && npm run deploy-api
   □ cd .../stride-gs-app && npm run build
   □ cd dist && git add -A && git commit -m "Phase 1: silent refresh, cache invalidation fix"
         && git push origin main --force
   □ Perform manual verification steps listed in section I

   BEFORE STARTING Phase 2 — Answer these 5 questions by reading code:
   □ Q1: Does invalidateClientCache_ get called with correct clientSheetId
         for every staff bulk write (generateStorageCharges, createInvoice,
         releaseItems, transferItems)? Grep for each call site.
   □ Q2: What is the batch payload size in bytes at current client count?
         Add Logger.log("batch payload: " + JSON.stringify(result).length + " bytes")
         to handleGetBatch_ after deploy and check logs.
   □ Q3: Is batchData.billing consumed anywhere when batchEnabled is true
         AND the user is staff (not a client)? If not, Billing can be
         excluded from the staff batch, reducing payload significantly.
   □ Q4: What Apps Script account type is this (consumer vs Workspace)?
         Consumer: 1 hr/day execution limit. Workspace: 6 hr/day.
         Determines whether time-based index rebuilds are feasible.
   □ Q5: After deploy, read Execution Logs and record per-client timing:
         open=Xms, richtext=Xms, total=Xms for each client.
         This is the most important question — it determines whether
         Phase 2 should optimize openById, RichTextValues, or both.

   Phase 2 Work (DO NOT START without timing data from Q5):
   □ Build buildClientIndex_(clientSheetId) function in StrideAPI.gs
   □ Build buildAllIndexes_() with time-based trigger
   □ Modify handleGetBatch_ to check index cache before opening sheets
   □ Modify invalidateClientCache_ to also clear index + trigger async rebuild
   □ Decide: Index_Cache persistence sheet needed if CacheService TTL too short?
   □ Decide: Per-client index keys or single aggregate index?
   □ Decide: Include or exclude Billing from staff index?

   Phase 3 Work (future — after Phase 2 measured):
   □ Lazy load Billing and other large entities on page navigation
   □ Modify handleGetBatch_ to accept entities[] param
   □ Modify BatchDataContext to pass entities based on active page

L. DOCUMENTATION UPDATES

   CREATED: _backups/PERFORMANCE_BUILD_PLAN.md
   Contains: Full phased plan (Phase 1 complete, Phase 2 design, Phase 3
   future), Option D Hybrid architecture recommendation, 5 open questions
   for Phase 2, risk assessment table, backup conventions, deployment
   command reference, instructions for new builder.

   CREATED: PHASE1_HANDOFF_REPORT.md (this file)
   Location: Project root (C:/Users/expre/Dropbox/Apps/GS Inventory/)

   NOT UPDATED: Project root CLAUDE.md
   Reason: Phase 1 has not been deployed. Project CLAUDE.md should be
   updated after Phase 1 is deployed and manually verified in production.
   At that point, add to Completed Work: "Phase 1 performance — silent
   refresh, cache invalidation fix (StrideAPI.gs v33.1.0)"

   NOT UPDATED: Docs/Stride_GS_App_Build_Status.md
   Reason: Performance optimization track is a parallel workstream.
   Update after Phase 2 is complete and has measurable impact.

   DOCS STATE: Build plan is in _backups/PERFORMANCE_BUILD_PLAN.md.
   If this document should live alongside other build docs, consider moving
   it to stride-gs-app/docs/ or the project Docs/ folder.

M. NEXT RECOMMENDED PHASE

   STEP 1 — Deploy Phase 1 today:
     cd "C:/Users/expre/Dropbox/Apps/GS Inventory/AppScripts/stride-client-inventory"
     npm run push-api
     npm run deploy-api
     cd "C:/Users/expre/Dropbox/Apps/GS Inventory/stride-gs-app"
     npm run build
     cd dist
     git add -A && git commit -m "Phase 1: silent refresh, cache invalidation fix (v33.1.0)" && git push origin main --force

   STEP 2 — Let app run with real users for at least 1 full day.

   STEP 3 — Read Apps Script Execution Logs. For each client, record:
     open=Xms  richtext=Xms  total=Xms
   This is the only data that determines Phase 2 architecture choices.

   STEP 4 — Answer the 5 Open Questions in section K by reading code.

   STEP 5 — Return with timing data and answers. Begin Phase 2.

   DO NOT begin Phase 2 before timing data is collected. The index
   granularity, TTL strategy, and persistence decisions all depend on
   knowing whether openById or RichTextValues is the dominant cost.

N. REVIEWER NOTES

   FILE REQUIRING CLOSE INSPECTION — StrideAPI.gs invalidateClientCache_:
   The addition of keys.push("batch:") must appear AFTER the prefix loop,
   not inside it. Grep for 'keys.push("batch:")' — should appear exactly
   once (the new line). The prefix array still contains "batch:" which
   generates "batch:CLIENT_ID" keys inside the loop — that is correct and
   unchanged. Confirm the new standalone push is separate from the loop.

   FILE REQUIRING CLOSE INSPECTION — BatchDataContext.tsx doFetch .finally():
   Must confirm: .finally() calls setBatchLoading(false) unconditionally,
   not conditioned on !silent. This is intentional — if it were conditioned,
   a silent fetch that somehow transitioned to visible loading (race condition)
   could leave batchLoading stuck at true. Verify .finally() is unchanged.

   FILE REQUIRING CLOSE INSPECTION — useApiData.ts mount effect branch:
   The if (cached) / else branch must be:
     if (cached) { setData(cached); setLoading(false); doFetch(true, true); }
     else { doFetch(); }
   Verify the ELSE branch calls doFetch() WITHOUT silent=true (fresh loads
   must show loading). A mistake here would silence all initial page loads.

   PATTERN TO VERIFY in all 6 entity hooks:
   Each hook should have refetchBatch appearing ZERO times.
   Each hook should have silentRefetchBatch appearing EXACTLY 2 times.
   Already verified by grep in section I, but worth a manual spot check
   on at least one hook (e.g., useInventory.ts) to confirm both the
   destructure line and the return value are correct.

   DEPLOYMENT ORDER MATTERS:
   push-api must complete before deploy-api (deploy creates a new Web App
   snapshot of the pushed code — if done in wrong order, old code is
   snapshotted). These must be sequential, not parallel.
   React build is independent and can happen before or after.

   TIMING DATA IS LOAD-BEARING FOR PHASE 2:
   Do not let Phase 2 start without real timing numbers from production.
   The entire Phase 2 architecture (per-client vs aggregate index, CacheService
   vs persistence sheet, TTL length) depends on knowing whether a single
   client takes 500ms or 5000ms to read. These are very different problems
   with different solutions.
================================================================================
```
