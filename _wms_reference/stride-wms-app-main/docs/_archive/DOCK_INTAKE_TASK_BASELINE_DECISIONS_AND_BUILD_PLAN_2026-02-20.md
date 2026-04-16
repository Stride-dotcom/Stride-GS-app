# Dock Intake UI Refresh - Q&A Decision Log + Pre-Build Plan

Date: 2026-02-20  
Branch: `cursor/dock-intake-details-ui-3c20`  
Status: Planning only (no build started yet)

---

## 1) Goal

Standardize Dock Intake Detail UI to match the Task Detail design language (layout, controls, status presentation, typography rhythm, and card patterns), while preserving all existing receiving functionality.

---

## 2) Q&A Decision Log (Captured from this session)

### Q1. Layout model
- **Decision:** Keep **full-scroll single page** layout (not tabbed page-level Receiving/Exceptions/Notes).

### Q2. Top layout structure
- **Decision:** Top area is a **two-column layout**:
  - **Left:** Stage 1 Shipment Summary + Signature
  - **Right:** Billing + Matching panels
- **Decision:** Billing and Matching should visually align with the top left sections.

### Q3. Below-the-fold layout
- **Decision:** The following sections should be **full width below top area**:
  - Stage 2 Items (item entry)
  - Photos
  - Documents
  - Activity

### Q4. Stage 2 scope
- **Decision:** Stage 2 is focused on **item entry** (not a separate complex page mode).

### Q5. Baseline style direction
- **Decision:** Use **Task page/detail style** as the baseline for Dock Intake and broader app consistency.

### Q6. Status strip
- **Decision:** Keep the **full-width color-changing status strip** (Draft / Stage 1 Complete / Receiving / Closed style strip).

### Q7. Action buttons placement
- **Decision:** `Edit`, `Add Charge`, `Add Credit` should be moved to the **left-side action area** so they are not under the billing calculator.

### Q8. Notes + Exceptions placement
- **Decision:** Build Notes/Exceptions **inside Shipment Summary section** (inline/tabs style), similar to the provided Task-style reference.
- **Decision:** Remove the old dedicated standalone exception button section.

### Q9. Exception chip location and flow
- **Decision:** Exception selection chips live in the **Exceptions tab** within the notes area.
- **Decision:** User should already be in exception-note context when adding exceptions.

### Q10. Required note behavior
- **Decision:** Clicking an exception requires an **immediate required-note popup** for every exception type before save.

### Q11. Multi-exception notes behavior
- **Decision:** One note field per exception; multiple exceptions should be viewable/editable via tab/chip switching in the Exceptions context.

### Q12. Unselect/remove behavior
- **Decision:** Once added, that exception should no longer appear in "available to add" list.
- **Decision:** To unselect/remove an exception, user opens that exception entry and uses a dedicated **Remove Exception** action.

### Q13. Functional safety requirement
- **Decision:** Do not lose prior Dock Intake functionality while restyling.
- **Decision:** Plan must be approved before implementation begins.

### Q14. Matching behavior preservation
- **Decision:** Preserve and verify account-scoped matching only (show candidates only for the selected account).
- **Decision:** Preserve deterministic match ranking/filter priority:
  1) Tracking, 2) Reference, 3) SKU, 4) Vendor, 5) Description, 6) Shipper.
- **Decision:** Preserve Expected + Manifest candidate behavior; never surface cross-account records.

### Q15. Stage 1 photo/document capture requirement
- **Decision:** Photos and Documents remain available during **Stage 1** (dock intake) for immediate dock-paperwork capture.
- **Decision:** Stage 2 may add more photos/documents later, but Stage 1 capture cannot be removed or blocked by layout changes.
- **Decision:** Full-width section placement is visual only and must not change stage availability rules.

---

## 3) Non-Negotiable Functional Parity (Must Preserve)

1. Stage 1 autosave behavior and field persistence  
2. Stage 1 validation and completion rules  
3. Signature capture/edit/clear behavior  
4. Exception persistence and required-note enforcement  
5. Matching panel linking behavior (single + multi-link)  
6. Billing actions + calculator refresh behavior  
7. Stage 2 item entry/save behavior  
8. Photo upload/capture and persistence  
9. Document scan/upload and persistence  
10. Timer start/pause/resume/rollback flows  
11. PDF generation/download/retry behavior  
12. Alerts/activity logging and closed-mode edit lock behavior

---

## 4) Pre-Build Execution Plan

## Phase A - Stabilize behavior baseline first
1. Remove fragile Stage 1 "capture during render" pattern in `ReceivingStageRouter`.
2. Re-establish clean, single-render data flow between router and Stage 1 sections.
3. Validate no regressions in Stage 1/Stage 2 transitions and draft/closed states.

Deliverable: stable functional baseline before UI restyle.

## Phase B - Apply Task-style layout shell to Dock Intake
1. Keep status strip at top.
2. Build Task-style header/action row with left-placed action buttons (`Edit`, `Add Charge`, `Add Credit`).
3. Build top two-column section:
   - left card stack: Shipment Summary + Signature
   - right rail: Billing + Matching
4. Move Items/Photos/Documents/Activity to full-width stack below top grid.

Deliverable: visual parity with chosen Task-style structure.

## Phase C - Exception UX refactor (embedded in summary notes)
1. Embed Notes tabs in Shipment Summary area (Internal/Public/Exceptions).
2. Move exception chip add-flow into Exceptions tab.
3. Implement required-note popup on chip click (all exception types).
4. Hide already-added exceptions from "available add" list.
5. Add explicit "Remove Exception" action in selected exception detail.
6. Keep one note per exception code and allow switching between multiple exceptions.

Deliverable: new exception UX matching decisions Q8-Q12.

## Phase D - Uniformity pass (Dock Intake page-level)
1. Normalize spacing, card headers, button hierarchy, chip/badge styling, and icon rhythm to Task pattern.
2. Ensure mobile/desktop behavior matches existing app conventions (sticky right rail on desktop, mobile-friendly placement).
3. Keep typography and interaction patterns consistent with TaskDetail.

Deliverable: professional, uniform Dock Intake Detail presentation.

## Phase E - Verification and acceptance
1. Functional regression checklist against Section 3.
2. Visual QA checklist against approved screenshots/decisions.
3. Confirm exception lifecycle behavior end-to-end.
4. Confirm role-based visibility for billing/credit actions.
5. Final user walkthrough and sign-off.

Deliverable: approved implementation with parity + design consistency.

---

## 5) Planned File Touches (Expected)

- `src/components/receiving/ReceivingStageRouter.tsx`
- `src/components/receiving/Stage1DockIntake.tsx`
- `src/components/receiving/StatusBar.tsx` (keep strip, minor style harmonization)
- Optional support updates if needed:
  - `src/components/shipments/ShipmentNotesSection.tsx` (only if shared tab behavior is reused safely)
  - shared style helpers only if strictly necessary

Note: Implementation should prefer composing existing stable components over introducing new bespoke UI primitives.

---

## 6) Broader App Uniformity Follow-On (After Dock Intake)

After Dock Intake is complete and stable, create a shared UI consistency initiative for:
- list/table shell patterns
- header/action bar conventions
- search/filter placement and behavior
- badge/status indicator semantics
- button variants and hierarchy
- card spacing/section rhythm

This ensures Tasks, Shipments, Incoming, and related pages converge toward one professional design system.

---

## 7) Sign-Off Gate Before Build

Implementation should start only after explicit confirmation that this decision log + plan matches intent.

