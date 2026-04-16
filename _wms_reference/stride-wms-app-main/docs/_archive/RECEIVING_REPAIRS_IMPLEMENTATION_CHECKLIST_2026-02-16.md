# Receiving Repairs — Implementation Checklist (Q&A 2026-02-16)
Branch: `cursor/receiving-workflow-repairs-657a`

Source of truth for decisions: `docs/RECEIVING_REPAIRS_INTAKE_QA_LOG_2026-02-16.md`

This checklist tracks implementation of each of the **89** logged decisions.

## Checklist

- [x] 1. Real scan scope: mobile/tablet only in-app; desktop upload-only.
- [x] 2. Stage 1 completion action: "Complete Stage 1" button unlocks Stage 2.
- [x] 3. Stage 2 auto-expand behavior: collapsed until user clicks "Start Stage 2"; then defaults expanded unless minimized.
- [x] 4. Persist "Start Stage 2" click to DB.
- [x] 5. Stage 1 remains editable after Stage 1 complete.
- [x] 6. Enforce piece-count mismatch prompting.
- [x] 7. Block completion until mismatch corrected or exception+note; add Shortage/Overage chips for piece discrepancies.
- [x] 8. Dedicated Overage chip exists.
- [x] 9. Exception chips are multi-select.
- [x] 10. Exceptions note model: initially shared but refined to per-exception inline notes.
- [x] 11. Exception note scope: shipment-level notes system (not stage-specific).
- [x] 12. Intake notes types: Public + Internal toggles like Item Details.
- [x] 13. Exception notes must be Public; mismatch between manifest vs expected doesn’t require note; piece discrepancies do.
- [x] 14. Stage 1 mismatch (Carrier vs Dock): live sync Shortage/Overage; keep those chips locked until mismatch corrected.
- [x] 15. Mis-Ship exception: manual; available once Stage 2 is visible (Stage 1 remains editable).
- [x] 16. Stage 2 mismatch (Dock vs Entry): no sync; prompt on Stage 2 completion; require correction or exception+note.
- [x] 17. Entry Count definition: row count (each row = piece).
- [x] 18. Signature not required for Stage 1 completion.
- [x] 19. Intake notes UI style matches Item Details notes UI (multi-note list + filters).
- [x] 20. Notes storage is shipment-level.
- [x] 21. Exception-note enforcement UX: Notes tab (later refined to inline per-chip notes).
- [x] 22. Public exception note required for all exception chips.
- [x] 23. Add "Exception" note type (tabs: All/Public/Internal/Exception).
- [x] 24. Generic Public note does NOT satisfy exception requirement; each selected chip needs its exception note(s).
- [x] 25. Carrier paperwork pieces input is manual.
- [x] 26. Carrier count required for Stage 1 completion; label "Carrier count" and tooltip help.
- [x] 27. Dock count required for Stage 1 completion; label "Dock Count" and tooltip help to all 3 counts.
- [x] 28. Stage 2 count labeled "Entry Count", read-only computed from row count.
- [x] 29. Removing an exception chip removes its corresponding exception note(s); log add/remove in activity history.
- [x] 30. Inline quick entry is one note per chip; more notes can be added later in Notes tab.
- [x] 31. Chip-generated exception notes are tied to that chip; exception notes created directly in Notes tab need not have a chip.
- [x] 32. Per-exception note entry appears inline in Exceptions section; still stored under Notes tab (Exception filter).
- [x] 33. Signature applies to Stage 1 carrier sign-for.
- [x] 34. Signature is persisted + viewable later on intake page and Shipment Details page.
- [x] 35. Signature metadata displayed (typed name + timestamp if present).
- [x] 36. Signature optional; if drawn signature is used, Driver name required; typed-only acceptable.
- [x] 37. Driver name label is "Driver name".
- [x] 38. Signature edit allows switching Draw/Type and Clear.
- [x] 39. Scanner output supports multi-page PDF.
- [x] 40. Scanner supports auto edge detection + manual crop adjustment.
- [x] 41. Scanner naming: no prompt; auto-name with shipment number + date + unique.
- [x] 42. Scanner environment: mobile web first; native later.
- [x] 43. Mobile web capture: prefer in-page live preview; allow file-input capture if needed.
- [x] 44. Implement scanner now, structure for later native swap.
- [x] 45. Alerts: avoid double-emailing; enhance Shipment Received email with optional Exceptions section; show exception indicator near shipment number.
- [x] 46. Shipment received email exceptions formatting: bullet/note style (types + notes), not item-specific.
- [x] 47. Implement item-level flags + alert tokens now.
- [x] 48. Item-level flag types: Damage, Wet, Missing documents, Crushed/Torn, Other, Open.
- [x] 49. Flags exist at both shipment level (exception exists) and item level (which piece).
- [x] 50. Shipment exception chip list: Damage, Wet, Open, Missing Docs, Crushed/Torn, Mis-Ship, Shortage, Overage, Other.
- [x] 51. Completed intake remains accessible on the same Dock Intake page; read-only by default; "Edit" unlocks changes without reopening status.
- [x] 52. Receiving PDF: save on Stage 2 completion; overwrite visible version; keep older versions archived (not deleted).
- [x] 53. Archived receiving PDFs revisited via interactive Activity feed (open/download).
- [x] 54. Activity entity links render inline within sentence (not chips).
- [x] 55. Redesigned Documents field reused on Quote detail page too.
- [x] 56. Quote detail page = Quote Builder (`/quotes/:id`).
- [x] 57. Quote Builder: replace legacy Attachments with redesigned Documents field.
- [x] 58. No migration needed for legacy quote attachments (none exist).
- [x] 59. Quote Builder is staff-only (admin + manager); clients cannot access Quotes or Quote Builder pages.
- [x] 60. "Closed" = `shipments.inbound_status = 'closed'` after Stage 2 completion; `received_at` set; intake workflow finished.
- [x] 61. Stage 2 completion sets `shipments.status = 'received'`; Received Today uses `received_at` today.
- [x] 62. Quote Builder documents: upload-only; UI + preview match Intake.
- [x] 63. Quote Builder documents header: single full-width Upload button.
- [x] 64. User-facing status label after Stage 2 completion: "Received".
- [x] 65. Hub expanded card row clicks originally specified Shipment Details for all rows (superseded by #79).
- [x] 66. "Intakes In Progress" excludes `inbound_status = closed`; include only draft/stage1_complete/receiving.
- [x] 67. "Intakes In Progress" row status label: always "In Progress".
- [x] 68. "Received Today" should not combine dock intakes with expected/manifest receipts (keep separate).
- [x] 69. Shipments Hub "Received Today" shows only dock intakes received today.
- [x] 70. Shipments Hub "Expected Today" shows scheduled expected shipments regardless of status/stage.
- [x] 71. `/shipments/received` shows only received dock intakes.
- [x] 72. `/shipments/received`: show all received dock intakes; default sort by received date (newest first).
- [x] 73. `/shipments/received`: search + sort only (no quick date filters).
- [x] 74. "Expected Today" date field = `expected_arrival_date`.
- [x] 75. "Expected Today" includes expected + manifests.
- [x] 76. Expanding "Expected Today" includes only scheduled inbound for today (expected + manifests), not unlinked dock intakes.
- [x] 77. "Expected Today" row click navigates to inbound detail pages (expected/manifest), not generic Shipment Details.
- [x] 78. "Received Today" (dock intakes) row click navigates to Dock Intake page (`/incoming/dock-intake/:id`).
- [x] 79. Hub expanded list clicks are card-specific: Expected Today -> inbound detail; Intakes In Progress -> Shipment Details; Received Today -> Dock Intake page.
- [x] 80. "Shipped Today" uses `completed_at` as the "today" timestamp.
- [x] 81. "Shipped Today" includes outbound statuses released + completed + shipped.
- [x] 82. "Shipped Today" expanded list row click navigates to outbound shipment details.
- [x] 83. Outbound shipment details page route is `/shipments/:id` for the OUT# clicked.
- [x] 84. Tapping "Shipped Today" card navigates to `/shipments/released` showing all (not limited to today), default newest completed first, search + sort only.
- [x] 85. Tapping "Received Today" card navigates to dock intakes list page showing all intakes.
- [x] 86. Dock intakes list page = Incoming Manager (`/incoming/manager`).
- [x] 87. Tapping "Intakes In Progress" card navigates to Incoming Manager on intakes view.
- [x] 88. Tapping "Expected Today" card navigates to Incoming Manager on expected view.
- [x] 89. Tapping "Shipped Today" card navigates to `/shipments/released`.

