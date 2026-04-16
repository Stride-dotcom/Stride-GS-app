# Repair Receiving Workflow — Implementation Checklist
Date: 2026-02-16

This checklist is derived from docs/RECEIVING_REPAIRS_INTAKE_QA_LOG_2026-02-16.md
and will be checked off during implementation so nothing is skipped.

## A) Stage 1 + Stage 2 combined page
- [x] Render Stage 1 + Stage 2 on the same page (legacy combined layout).
- [x] Implement "Complete Stage 1" button (sets inbound_status -> stage1_complete).
- [x] After Stage 1 complete, show Stage 2 section on same page (collapsed).
- [x] Add "Start Stage 2" button (persist to DB; inbound_status -> receiving).
- [x] Once Stage 2 started, default Stage 2 expanded on reloads (unless user collapses locally).
- [x] Keep Stage 1 visible/editable during Stage 2 (photos/docs/exceptions/notes/signature all editable).

## B) Piece counts redesign + mismatch prompting
- [x] Rename counts:
  - [x] "Carrier count" (manual, required) = what you sign for (paperwork).
  - [x] "Dock Count" (required) = Stage 1 actual count.
  - [x] "Entry Count" (read-only) = number of Stage 2 item rows (each row = 1 piece).
- [x] Add help icon tooltips to all 3 count fields.
- [x] Move Stage 2 "received pieces" input into Shipment Summary (and remove Stage 2 manual entry).
- [x] Stage 1 mismatch logic (Carrier vs Dock):
  - [x] Auto-sync Shortage/Overage chip based on mismatch direction.
  - [x] Lock auto-synced Shortage/Overage chip until mismatch corrected.
  - [x] Block Stage 1 completion if mismatch exists and required exception note missing.
- [x] Stage 2 mismatch logic (Dock vs Entry):
  - [x] On Complete Stage 2, if mismatch: prompt user to review.
  - [x] Require user to either fix discrepancy (counts match) OR select exception chip(s) + notes to proceed.

## C) Shipment-level exception chips (save + notes + persistence)
- [x] Implement shipment-level chip set:
  - [x] Damage
  - [x] Wet
  - [x] Open
  - [x] Missing Docs
  - [x] Crushed/Torn
  - [x] Mis-Ship
  - [x] Shortage
  - [x] Overage
  - [x] Other
- [x] Ensure multi-select behavior (no "No Exceptions" chip).
- [x] Fix persistence: selecting chip creates/saves exception; notes persist across reload.
- [x] Other requires note.
- [x] Notes required for all chips for stage completion requirements (client-visible exception notes).
- [x] Log chip add/remove and note add/remove in shipment activity/audit history.

## D) Item-level flags (Stage 2 rows + Item Detail) + alert tokens
- [ ] Ensure Stage 2 item rows can apply item-level flags:
  - [ ] Damage, Wet, Open, Missing documents, Crushed/Torn, Other.
- [ ] Ensure Item Detail flags area supports the same flag set (leveraging existing flag system).
- [ ] Implement alert tokens for item-level flags so alerts can reference the flag type/details.

## E) Notes system (Public/Internal/Exception) — shipment-level
- [ ] Implement shipment notes UI like Item Details notes UI:
  - [ ] New note composer toggle: Internal / Public / Exception.
  - [ ] Filters: All / Internal / Public / Exception.
- [ ] Store as shipment-level notes (client portal should see Public + Exception).
- [ ] Exception chip quick-entry:
  - [ ] When a chip is selected, show inline note field for that exception.
  - [ ] Saving that inline note creates an Exception note entry (tied to exception code/type).
  - [ ] Removing chip removes its corresponding exception note entry.
  - [ ] If user adds an Exception note from Notes tab directly, it may be untied to a chip.

## F) Signature UX (Stage 1 carrier sign-for)
- [x] Signature optional overall.
- [x] Support Draw OR Type signature.
- [x] If Draw is used: require Driver name.
- [ ] After capture/save:
  - [x] Render signature (image or typed) in the signature field.
  - [x] Button changes from "Capture" -> "Edit".
  - [x] Edit allows switching Draw/Type and allows Clear signature.
- [ ] Persist signature + metadata; display on intake page AND Shipment Details:
  - [ ] Driver name (typed)
  - [ ] Signed at timestamp

## G) Document scanner: "real scan" -> B/W multi-page PDF (mobile web v1)
- [ ] Multi-page scanning into a single PDF.
- [ ] Output is black & white PDF generated in-app (not device camera behavior).
- [ ] Auto edge detection + manual crop adjustment (scanner-style UX).
- [ ] No user naming prompt; auto-name using shipment number + date + unique component.
- [ ] Desktop behavior: upload only.
- [ ] Structure code so native iOS/Android scanner can replace web implementation later.

## H) Alerts / email template changes (avoid double-email)
- [ ] Do NOT send an extra "exception added" email at Stage 2 completion.
- [ ] Enhance existing Shipment Received email:
  - [ ] Add Exceptions section that is blank when no exceptions.
  - [ ] Include exception types + notes (bullet list).
  - [ ] Add tokens for exception types + notes for templating.

## I) Exception indicator near shipment number
- [ ] Show a warning indicator near shipment number anywhere it is displayed (e.g., hub lists),
      based on open shipment exceptions and item flags counts.

