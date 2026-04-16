# Receiving System Phase 4 Forensic Extraction (Authoritative Working Ledger)

Date: 2026-02-14  
Branch: `cursor/receiving-structural-repairs-0165`

## 1) Purpose

This document is a forensic extraction of:

1. The receiving-system decisions made in this chat thread and prior iterations.
2. The authoritative uploaded baseline document.
3. The current code state on this branch.

This is intended to be the execution ledger for finishing receiving updates without requirement drift.

---

## 2) Source Artifacts Used

1. Uploaded authoritative master:
   - `/home/ubuntu/.cursor/projects/workspace/uploads/STRIDE_Receiving_Master_Authoritative_Combined.pdf`
2. Prior conversation history summary provided in-chat (phases R1/R2/R3, behavior clarifications, conflict repairs).
3. Current branch implementation evidence in `src/` and `supabase/migrations/`.

---

## 3) Locked Decisions (Cross-Chat + Authoritative PDF)

## 3.1 Core inbound model

- Inbound uses a unified `shipments` model with `inbound_kind`:
  - `manifest`
  - `expected`
  - `dock_intake`
- Prefix expectations:
  - Manifest: `MAN-`
  - Expected: `EXP-`
  - Dock intake: `INT-`
  - Outbound: `OUT-`

## 3.2 Account and unidentified workflow

- Account must be present for inbound workflows; if unknown, use global `UNIDENTIFIED SHIPMENT`.
- Global unidentified account must be auto-provisioned per tenant.
- `ARRIVAL_NO_ID` is a permanent arrival condition marker when applied (do not auto-remove later).
- Alerting for unidentified intake completion must work independently of billing toggle behavior.

## 3.3 Exceptions and flags

- "Issues" renamed to "Exceptions".
- Shipment-level exceptions are captured at Stage 1.
- Item-level flags are captured at Stage 2.
- `Crushed/Torn Cartons` must exist as a shipment-level exception.
- User clarification history preserved structural controls for:
  - `MIS_SHIP`
  - `RETURN_TO_SENDER`
- User clarification: refusal should require immediate note capture.

## 3.4 Legacy parity requirement (Phase 4 target)

- Stage 1 dock intake should mirror legacy shipment header/summary behavior.
- Stage 2 item entry should match legacy item-entry behavior and interaction pattern.
- Flag UI in Stage 2 should be per-item dropdown/expand tray.

## 3.5 Navigation and search

- Incoming sidebar item removed; ship through Shipments Hub.
- Search contract should include broad matching, including notes and reference fields.

---

## 4) What Is Already Implemented (High Confidence)

1. R3 unidentified automation and alert trigger integration:
   - `supabase/migrations/20260214201000_nvpc_phase_r3_unidentified_account_arrival_flag_alert.sql`
   - `src/hooks/useUnidentifiedAccount.ts`
   - `src/components/receiving/Stage2DetailedReceiving.tsx` (auto-flag and queue alert paths)
2. Shipment exception controls restored:
   - `src/components/receiving/ShipmentExceptionActions.tsx`
   - `src/components/receiving/ReceivingStageRouter.tsx`
3. Legacy discrepancy backfill into `shipment_exceptions`:
   - `supabase/migrations/20260214213000_backfill_receiving_discrepancies_to_shipment_exceptions.sql`
4. No-exceptions state divergence fix in Stage 1 toggle handling:
   - `src/components/receiving/Stage1DockIntake.tsx`
5. `/incoming` redirect and Shipments Hub routing pattern are present:
   - `src/App.tsx`
   - `src/pages/Shipments.tsx`
   - `src/components/layout/DashboardLayout.tsx`

---

## 5) Phase 4 Forensic Gap Matrix (Done vs Partial vs Missing)

| Requirement | Status | Evidence | Gap to Close |
|---|---|---|---|
| Stage 1 legacy header parity | Partial | `src/components/receiving/Stage1DockIntake.tsx` | Current layout is custom card stack, not strict legacy parity structure. |
| Remove standalone driver field | Missing | `Stage1DockIntake.tsx` (`driverName` state + input at ~L468-L474) | Driver field still present. |
| Stage 1 account field in-flow | Missing/Partial | `Stage1DockIntake.tsx` has no account selector; account set earlier in creation flows | If account must be editable/visible in Stage 1, control is absent there. |
| Stage 1 uploads parity (Photos + Documents) | Partial | `Stage1DockIntake.tsx` includes photo categories only | No matching documents capture flow in Stage 1 parity surface. |
| Stage 2 legacy grid columns/order (Qty, Vendor, Description, Glass, Side Mark, Room) | Missing | `Stage2DetailedReceiving.tsx` table uses Description/Expected/Received/Pkg/Source | Column model differs from locked parity contract. |
| Stage 2 duplicate-row behavior | Missing | `Stage2DetailedReceiving.tsx` has add/remove only | No explicit duplicate action in stage grid. |
| Stage 2 per-item expandable flag tray | Missing | No flag tray UI in `Stage2DetailedReceiving.tsx` | Flags are auto-applied backend-only for unidentified path; no per-item tray UX. |
| Manifest/Expected item entry reuse of legacy component | Partial/Missing | `InboundManifestDetail.tsx` and `ExpectedShipmentDetail.tsx` use custom tables | Not using/copying the legacy row interaction model (`ShipmentItemRow` pattern) for parity. |
| Exception checklist alignment (mismatch-oriented list) | Missing/Drift | `useShipmentExceptions.ts` codes are condition-oriented (`DAMAGE`, `WET`, etc.) | Authoritative list includes mismatch categories; taxonomy mismatch remains. |
| Badge count formula includes shipment exceptions + item flags | Missing | `ShipmentExceptionBadge.tsx` uses shipment exception open count only | No merged count of item-level flags. |
| Search all fields including line notes/refs | Partial/Missing | `useIncomingShipments.ts` filters limited fields client-side | No full-field search contract implementation (line-level notes/refs not covered). |
| Outbound behavior for structural exceptions | Drift | `ShipmentExceptionActions.tsx` banner says outbound blocked until resolved | Chat decision indicates outbound should not be blocked for return workflows. |
| Centralized help content table/editor (`page_key`,`field_key`) | Missing | No migration/table/editor found for field-help contract | `HelpTip` exists, but no central per-field authoring system aligned to contract. |

---

## 6) Additional Drift Risks Identified

1. Exception models are split across:
   - `shipment_exceptions` (condition codes)
   - `shipment_exception_type` on `shipments` (structural controls)
   This can lead to UX inconsistency unless unified in presentation and semantics.

2. Search implementation is currently mixed and partially client-side, which will not satisfy full-field/notes requirements at scale.

3. Stage 2 receives items and creates inventory units, but does not expose parity-level per-item flag editing during intake.

---

## 7) Execution Plan to Complete Phase 4 (No-Drift Order)

1. **Stage 1 parity pass**
   - Remove driver field.
   - Add/confirm account control visibility where required.
   - Align Stage 1 layout to legacy summary structure.
   - Add documents capture parity alongside photos.

2. **Stage 2 legacy grid replacement**
   - Replace current table with legacy parity row model:
     - Quantity, Vendor, Description, Glass, Side Mark, Room
     - Add row + duplicate row + row expand behaviors
   - Add per-item flag tray expansion model in Stage 2.

3. **Manifest/Expected parity harmonization**
   - Reuse/copy legacy item row/editor behavior consistently for inbound detail pages.

4. **Exception + badge alignment**
   - Finalize authoritative checklist taxonomy handling.
   - Unify badge computation to include Stage 2 item-level flags where required.

5. **Search contract completion**
   - Implement server-side full-field search contract with notes/reference coverage.

6. **Behavior correction pass**
   - Align `MIS_SHIP` / `RETURN_TO_SENDER` messaging and guards with chosen outbound behavior.

7. **Verification gate**
   - `npx tsc --noEmit`
   - `npm run build`
   - Focused QA on Stage 1/2 parity, exception flows, and search coverage.

---

## 8) Acceptance Snapshot for "Phase 4 Complete"

Phase 4 is complete only when all are true:

1. Stage 1 and Stage 2 visually and behaviorally match legacy intake expectations.
2. Stage 2 includes per-item flag tray UX.
3. Required columns/order and duplicate/add interactions are present.
4. Structural exception controls remain available and behavior-aligned.
5. Search behaves per full-field contract.
6. No conflicting messaging remains around outbound handling for return workflows.
7. Build/typecheck pass and receiving regression flows pass.

---

## 9) Recommended Immediate Next Action

Execute Phase 4 in two implementation batches to reduce risk:

- Batch A: Stage 1 + Stage 2 parity UI replacement.
- Batch B: Exception/badge/search alignment and behavior consistency pass.

Then run final regression and merge.

