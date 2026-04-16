# Time Tracking — Q&A Decisions Implementation Checklist

This checklist is derived from the Time Tracking Q&A decisions captured during planning.
Each item is phrased as **Decision → Implementation requirement**.

Legend:
- [x] Implemented
- [ ] Not implemented yet

---

## Scope / coverage

- [x] **Scope:** Track time for **Tasks** (Q60 priority: Tasks first)
- [x] **Scope:** Track time for **Shipments** (Incoming + Outbound)
  - [x] Incoming Dock Intake (Stage 1)
  - [x] Incoming Dock Intake (Stage 2 / receiving)
  - [x] Outbound shipments (Pull step + Release step)
- [x] **Scope:** Track time for **Stocktakes** (timer + prompts + snapshots)

---

## Timer behavior (start / pause / resume / end)

- [x] **Single active timer per user** enforced at DB level (unique active interval per user)
- [x] **Prompt when starting a 2nd job:** if a user has an active timer and tries to start another job, show a confirmation to pause the current job (Q8/Q9/Q10)
  - [x] Tasks “Start” from list
  - [x] Start Dock Intake
  - [x] Start Receiving (Stage 2)
  - [x] Outbound Pull / Release
  - [x] Stocktake start
- [x] **Pause/Resume buttons allowed** — manual controls exist via `JobTimerWidget`
- [x] **After completing Job B, prompt to resume paused Job A** (Q22/Q23)
  - [x] Prompt shows which task is paused (title)
  - [x] User can choose which paused task to resume (keeps up to 3)
  - [x] If user declines, confirm that it won’t auto-resume

---

## Time definitions (how we calculate minutes)

- [x] **Labor time:** sum of active interval time across users on the job (Q18/Q24) (Phase 1: effectively single-user)
- [x] **Cycle time:** wall-clock minus paused time (Q17) (Phase 1 implementation: equals labor minutes because pauses create gaps between intervals)
- [x] **Multi-user “collaborate mode” UX** (Q19/Q25/Q26/Q27 + Q37/Q38)
  - [x] If another user already started the job, prompt to continue (UI)
  - [x] Manager/admin toggle to allow/disable collaborate mode per job type (tenant preferences)

---

## Estimated service time (from pricing rules)

- [x] **Q57:** Use `service_time_minutes` to compute estimated minutes based on unit + quantity
- [x] **Q58:** `unit=per_task` uses multiplier `1` (estimate = `service_time_minutes`)
- [x] **Q59:** Snapshot estimated minutes onto the job at completion (protect history from price list changes)
  - [x] Tasks snapshot into `tasks.metadata.service_time`
  - [x] Shipments snapshot into `shipments.metadata.service_time`
  - [x] Stocktakes snapshot into `stocktakes.metadata.service_time` (actual-only for now)

---

## Actual service time snapshotting (for reporting / display)

- [x] Snapshot actual minutes at completion (best-effort; must not block completion)
  - [x] Tasks: store `duration_minutes` + `metadata.service_time.actual_*`
  - [x] Shipments: store `metadata.service_time.actual_*`
  - [x] Stocktakes: store `duration_minutes` + `metadata.service_time.actual_*` on close

---

## Time display (UI)

- [x] Tasks list shows “Actual Time” column (completed tasks)
- [x] Task detail shows live timer when in progress (`JobTimerWidget`)
- [x] Shipment detail shows live timer in relevant in-progress banners (`JobTimerWidget`)
- [x] Shipment detail shows **snapshotted** service time (Estimated vs Actual) after completion
- [x] Stocktake pages show live timer + completed time

---

## Dashboard visibility

- [x] Dashboard tile/card: list all currently active jobs across the tenant (Q20/Q21)
  - [x] Shows elapsed time for each active job
  - [x] Clickable row opens job details page (Q28/Q29)
  - [x] Indicates paused vs active (Q30)

---

## Manager/admin adjustments

- [x] Managers/admins can edit actual service time (Q35/Q36) (with audit safety)
  - [x] Ensure “total service time” remains accurate after edits (updates `duration_minutes` / `metadata.service_time.actual_*`)
  - [x] Store edit in job activity history / audit trail (`*_activity` via `logActivity`)

---

## Offline mode

- [x] Offline mode supported for timer events + completion (Q54/Q55/Q56)
  - [x] If offline, allow user to start/stop timers; queue intervals locally and sync when online
  - [x] Notify user that changes will sync later (toast + background sync manager)

