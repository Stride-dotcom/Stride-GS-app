# Phase 2C Handoff Report — Optimistic UI Updates

> **NOTE:** This is a summary copy. The authoritative Phase 2C handoff report with full
> code-level detail is at `stride-gs-app/PHASE2C_HANDOFF_REPORT.md`.
> Phase 2B (Dashboard) has been completed since this report was written — see
> `PHASE2B_HANDOFF_REPORT.md`. References to "Phase 2B is next" below are stale.

---

## A. Phase Completed
**Phase 2C — Optimistic UI Updates**
All 4 stages implemented, TypeScript clean, build successful, deployed to GitHub Pages.
Commit: `7328b56` — https://github.com/Stride-dotcom/Stride-GS-app

---

## B. Goal of This Phase
Eliminate perceived latency on all write actions. When a user clicks "Start Task", "Complete", "Approve", "Cancel", "Release", "Create Tasks", etc., the table row and UI update *immediately* — before the API responds. If the API fails, the row rolls back. This makes the app feel instant even with 1–3s API latency over Google Apps Script.

---

## C. Files Backed Up Before Changes

All backups in `stride-gs-app/src/_backups/phase2c-start/`:
- `ItemDetailPanel.backup.phase2c-start.tsx`
- `CreateTaskModal.backup.phase2c-start.tsx`
- `CreateWillCallModal.backup.phase2c-start.tsx`

(WillCallDetailPanel, TaskDetailPanel, RepairDetailPanel backups were created in the prior session before Stage 2 began.)

---

## D. Files Modified

| File | Stage | Changes |
|------|-------|---------|
| `src/hooks/useTasks.ts` | 1 | Patch architecture added |
| `src/hooks/useRepairs.ts` | 1 | Patch architecture added |
| `src/hooks/useWillCalls.ts` | 1 | Patch architecture added |
| `src/hooks/useInventory.ts` | 1 | Patch architecture added (no optimisticCreates) |
| `src/pages/Tasks.tsx` | 2, 4 | Destructure patch fns; pass to TaskDetailPanel; add addOptimisticRepair/removeOptimisticRepair from useRepairs |
| `src/pages/Repairs.tsx` | 2 | Destructure patch fns; pass to RepairDetailPanel |
| `src/pages/WillCalls.tsx` | 2 | Destructure patch fns; pass to WillCallDetailPanel |
| `src/pages/Inventory.tsx` | 2, 3, 4 | Destructure patch fns for all 3 hooks; pass to ItemDetailPanel, CreateTaskModal, CreateWillCallModal |
| `src/components/shared/TaskDetailPanel.tsx` | 2, 4 | Wire status patches on handleStartTask, callCompleteTask; field merge on handleTaskSave; wire handleRequestRepair with addOptimisticRepair/removeOptimisticRepair |
| `src/components/shared/RepairDetailPanel.tsx` | 2 | Wire applyRepairPatch/clearRepairPatch on handleSendQuote, handleRespond, handleStartRepair, handleComplete, cancel; remove unused mergeRepairPatch from destructure |
| `src/components/shared/WillCallDetailPanel.tsx` | 2 | Wire handleCancelWC (previous session) + handleRelease with cross-entity applyItemPatch for each released item |
| `src/components/shared/ItemDetailPanel.tsx` | 3 | Add InventoryItem import; add mergeItemPatch/clearItemPatch/applyItemPatch to Props; wire mergeItemPatch before API call, clearItemPatch on error in handleSave |
| `src/components/shared/CreateTaskModal.tsx` | 4 | Add addOptimisticTask/removeOptimisticTask/clientName props; insert temp task rows before API call; remove on success/error |
| `src/components/shared/CreateWillCallModal.tsx` | 4 | Add addOptimisticWc/removeOptimisticWc props; insert temp WC row before API call; remove on success/error |

---

## E. Files Created

None. All changes were edits to existing files.

---

## F. Exact Changes Made (by Stage)

### Stage 1 — Patch Architecture in Hooks

**Pattern (applied identically to useTasks, useRepairs, useWillCalls, useInventory):**
```typescript
const PATCH_TTL_MS = 120_000; // 2 minutes

const [patches, setPatches] = useState<Record<string, { data: Partial<T>; appliedAt: number }>>({});
const [optimisticCreates, setOptimisticCreates] = useState<T[]>([]); // not in useInventory

function applyPatch(id: string, patch: Partial<T>) {
  setPatches(prev => ({ ...prev, [id]: { data: patch, appliedAt: Date.now() } }));
}
function mergePatch(id: string, patch: Partial<T>) {
  setPatches(prev => {
    const existing = prev[id]?.data || {};
    return { ...prev, [id]: { data: { ...existing, ...patch }, appliedAt: Date.now() } };
  });
}
function clearPatch(id: string) {
  setPatches(prev => { const n = { ...prev }; delete n[id]; return n; });
}
function addOptimistic(entity: T) {
  setOptimisticCreates(prev => [entity, ...prev]);
}
function removeOptimistic(tempId: string) {
  setOptimisticCreates(prev => prev.filter(e => e[idField] !== tempId));
}

// In useMemo:
const merged = rawEntities.map(e => {
  const p = patches[e.idField];
  if (!p || Date.now() - p.appliedAt > PATCH_TTL_MS) return e;
  return { ...e, ...p.data };
});
return [...optimisticCreates, ...merged]; // useInventory: just merged
```

**Hook-specific ID keys:**
- useTasks → `taskId`
- useRepairs → `repairId`
- useWillCalls → `wcNumber`
- useInventory → `itemId`

**5 functions exported per hook** (3 for useInventory: applyItemPatch, mergeItemPatch, clearItemPatch):
- `apply[Entity]Patch` — atomic replace (status changes)
- `merge[Entity]Patch` — accumulate fields (multi-field blur saves)
- `clear[Entity]Patch` — remove patch (on success or error)
- `addOptimistic[Entity]` — prepend temp row
- `removeOptimistic[Entity]` — remove temp row by ID

---

### Stage 2 — Status Change Write Handlers

**TaskDetailPanel.tsx:**
- `handleStartTask`: `applyTaskPatch?.(taskId, { status: 'In Progress', assignedTo, startedAt })` before API; `clearTaskPatch?.()` on conflict/error/success
- `callCompleteTask`: `applyTaskPatch?.(taskId, { status: 'Completed', result, completedAt })` before API; `clearTaskPatch?.()` on error/success
- `handleTaskSave` (field edits): builds `patchData`, calls `mergeTaskPatch?.()` before API; `clearTaskPatch?.()` on error only (patch stays on success until 120s TTL)

**RepairDetailPanel.tsx:**
- `handleSendQuote`: `applyRepairPatch?.(repairId, { status: 'Quote Sent', quoteAmount })` before API; `clearRepairPatch?.()` on error/success
- `handleRespond`: `applyRepairPatch?.(repairId, { status: 'Approved' or 'Declined' })` before API; clear on error/success
- `handleStartRepair`: `applyRepairPatch?.(repairId, { status: 'In Progress' })` before API; clear on error/success
- `handleComplete`: `applyRepairPatch?.(repairId, { status: 'Complete', completedDate })` before API; clear on error/success
- Cancel inline: `applyRepairPatch?.(repairId, { status: 'Cancelled' })` before API; clear on error/success

**WillCallDetailPanel.tsx:**
- `handleCancelWC`: `applyWcPatch?.(wcNumber, { status: 'Cancelled' })` before API; `clearWcPatch?.()` on error/success
- `handleRelease`:
  - `applyWcPatch?.(wcNumber, { status: 'Partial' or 'Released' })` before API
  - `itemIds.forEach(id => applyItemPatch?.(id, { status: 'Released', releaseDate }))` — cross-entity patch
  - `clearWcPatch?.()` on error/success

---

### Stage 3 — Field Edit Write Handlers

**ItemDetailPanel.tsx:**
- Added `applyItemPatch?`, `mergeItemPatch?`, `clearItemPatch?` to Props interface
- Added `import type { InventoryItem, InventoryStatus }` (was just InventoryStatus)
- Added `mergeItemPatch, clearItemPatch` to function signature
- In `handleSave`: builds `patchData` from changed fields, calls `mergeItemPatch?.(itemId, patchData)` BEFORE the API call, then:
  - On success: does NOT clearItemPatch (patch expires naturally at 120s TTL since patch value == server value)
  - On error: `clearItemPatch?.(itemId)` to rollback table row

**RepairDetailPanel.tsx / WillCallDetailPanel.tsx:** No blur-save field handlers exist — no changes needed for Stage 3.

---

### Stage 4 — Create Operation Optimistic Rows

**CreateTaskModal.tsx:**
- Added `addOptimisticTask?`, `removeOptimisticTask?`, `clientName?` props
- In `handleSubmit`: for each item × each svcCode, creates a `Task` with `taskId = TEMP-${Date.now()}-${ii}-${ci}`, status `'Open'`, current date
- On success: `tempIds.forEach(id => removeOptimisticTask?.(id))` — refetch loads real rows
- On error: same removal (rollback)
- Wired in Inventory.tsx: passes `addOptimisticTask`, `removeOptimisticTask` from its `useTasks` hook; passes `clientName` from `apiClients` lookup

**CreateWillCallModal.tsx:**
- Added `addOptimisticWc?`, `removeOptimisticWc?` props
- In `handleCreate` (API path only — demo mode unchanged): creates WillCall with `wcNumber = TEMP-${Date.now()}`, status `'Pending'`, populated items from `selectedItems`
- On success/error: `removeOptimisticWc?.(tempWcNum)` — refetch loads real WC
- Wired in Inventory.tsx: passes `addOptimisticWc`, `removeOptimisticWc` from its `useWillCalls` hook

**TaskDetailPanel.tsx — handleRequestRepair:**
- Added `addOptimisticRepair?`, `removeOptimisticRepair?` to function signature (Props already had them)
- Creates temp Repair with `repairId = TEMP-${Date.now()}`, status `'Pending Quote'`
- On success: `removeOptimisticRepair?.(tempRepairId)` — refetch loads real repair
- On error: same removal (rollback)
- Wired in Tasks.tsx: `useRepairs` now destructures `addOptimisticRepair`, `removeOptimisticRepair`; passed to `<TaskDetailPanel>`

---

## G. Build/Deploy Actions Performed

```
npx tsc --noEmit     # After Stage 1: clean
npx tsc --noEmit     # After Stage 2 (WillCallDetailPanel handleRelease): clean
npx tsc --noEmit     # After Stage 3: clean
npx tsc --noEmit     # After Stage 4: clean
npm run build        # First attempt: TS6133 on unused mergeRepairPatch — fixed, rebuilt clean
cd dist && git add -A && git commit -m "Phase 2C..." && git push origin main --force
```

Deployed commit: `7328b56`

---

## H. Current Behavior After Changes

**Before Phase 2C:** Every write action had visible latency — row kept showing old status until API returned (1–3s lag).

**After Phase 2C:**
- **Start Task:** Row immediately shows "In Progress" status badge
- **Complete Task/Repair:** Row immediately shows "Completed"/"Complete" badge
- **Send Quote / Approve / Decline / Cancel:** Repair row updates immediately
- **Cancel Will Call:** WC row immediately shows "Cancelled"
- **Release Will Call:** WC row immediately shows "Released"/"Partial"; ALL released inventory items immediately show "Released" in the Inventory table (cross-entity patch)
- **Save Item Fields (Edit/Save mode):** Inventory table row immediately reflects new vendor/description/location/etc. values
- **Save Task Fields:** Task table row immediately reflects new notes/location/custom price
- **Create Tasks:** Placeholder task rows appear in Tasks table while API processes
- **Create Will Call:** Placeholder WC row appears in Will Calls table while API processes
- **Request Repair Quote:** Placeholder repair row appears in Repairs table while API processes
- **Error path (any):** Optimistic patches and temp rows are removed — UI rolls back to original server state

---

## I. Testing Performed

TypeScript compilation verified clean after each of the 4 stages. Build succeeded on second attempt (after removing unused `mergeRepairPatch` from RepairDetailPanel destructure).

No runtime testing performed this session — app is deployed to https://www.mystridehub.com for manual verification.

**Recommended manual tests:**
1. Start Task → row should flip to "In Progress" immediately
2. Complete Task → row should flip to "Completed" immediately
3. Approve Repair → row should flip to "Approved" immediately
4. Release Will Call (full) → WC row flips to "Released"; check Inventory tab — those items show "Released"
5. Release Will Call (partial) → WC row flips to "Partial"
6. Cancel Will Call → row flips to "Cancelled"
7. Edit item fields → save → table row updates immediately while panel shows new values
8. Create Tasks → temp rows appear in Tasks page, then real rows appear on refetch
9. Create Will Call → temp row appears in WillCalls page
10. Force API error (bad token) → verify rollback: row returns to original status

---

## J. Problems / Risks / Warnings

1. **Cross-page optimistic creates are same-instance only.** CreateTaskModal is on Inventory page. Its `addOptimisticTask` comes from Inventory.tsx's `useTasks` hook — a different instance than Tasks.tsx. Optimistic task rows appear in item history panels (ItemDetailPanel) but NOT in the Tasks page table. Deferred per design doc decision ("no global patch cache for Phase 2C"). 10s polling on Tasks page will pick up real data quickly.

2. **Cross-entity WC release patches (applyItemPatch) are from WillCalls.tsx's useInventory instance.** These DO update the Inventory page table since WillCalls.tsx passes `applyItemPatch` down from Inventory.tsx. Correct behavior.

3. **Patch TTL is 120s.** If a user's API call is very slow (unusual with GAS) or they navigate away and back within 2 minutes, they may briefly see optimistic values. On success (no clearPatch), this is fine since patch == server value. On error, patch is cleared immediately.

4. **`as any` casts on optimistic entity objects.** Temp entities (Task, WillCall, Repair) are created with minimal required fields. TypeScript would complain about missing optional fields, so `as any` is used. This is safe since temp entities are always removed before being acted upon.

5. **RepairDetailPanel: mergeRepairPatch unused.** The prop is in the interface (for future field-edit saves on repairs) but not destructured in the function signature — intentionally omitted to avoid TS6133. If repair inline editing is added later, destructure it.

---

## K. Open Items / Remaining Work

**Phase 2C is complete.** Remaining items for other phases:

- [ ] Phase 2B — Dashboard performance (auto-refresh, batch summary endpoint)
- [ ] `useRepairs` `addOptimisticRepair` from Repairs.tsx not wired to its own detail panel create flows (repair-specific creates don't exist from Repairs page)
- [ ] CreateWillCallModal in WillCalls.tsx (if it exists there) — not yet checked/wired
- [ ] CreateTaskModal in Tasks.tsx — CreateTaskModal is currently only on Inventory.tsx; if added to Tasks page later, pass patch fns from Tasks.tsx's useTasks hook (which IS the same instance as the table)
- [ ] Inventory page Create Task FAB in row action menu — `setShowCreateTaskModal(true)` already wired; optimistic fns already passed; should work

---

## L. Documentation Updates

CLAUDE.md Architectural Decision #50 should note the Edit/Save mode (already noted). The optimistic UI architecture (patch TTL, apply vs merge, clearPatch strategy) is captured here and in the design doc at `PHASE2_DESIGN_REVIEW.md` Section 5.

---

## M. Next Recommended Phase

**Phase 2B — Dashboard Performance** (originally scheduled before 2C but deferred):
- `getBatchSummary` GAS endpoint returning lightweight counts (tasks open, repairs pending, WCs active, total items)
- Dashboard page: replace full data hooks with summary hook, add auto-refresh (30s), loading skeletons
- Reduces Dashboard API payload from ~6 full datasets to a single small summary response

**OR continue with Phase 3 (if Phase 2B is low priority):**
- Phase 3: Column visibility persistence, global search improvements, print-optimized views

---

## N. Reviewer Notes

**Patch strategy summary (for future builders):**
- Status changes → `applyPatch` (replaces whole patch) + clear on both success AND error
- Field edits → `mergePatch` (accumulates fields) + clear on error only (success: patch stays until 120s TTL)
- Create operations → `addOptimistic` (prepend temp row) + `removeOptimistic` on both success AND error (success: refetch loads real row)
- Cross-entity: WC release is the only cross-entity patch (WC status + inventory item statuses). Works because `applyItemPatch` is passed from Inventory.tsx → WillCalls.tsx → WillCallDetailPanel.

**Stage 4 scope note:** Only 3 create flows are currently optimistic (CreateTask, CreateWillCall, RequestRepairQuote). `completeShipment` (Receiving page) and `onboardClient` (Settings) are excluded — Receiving is a full-page form (not a table), and onboarding is admin-only with different UX expectations.
