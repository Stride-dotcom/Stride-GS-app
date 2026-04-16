# Repair Receiving Workflow (Stage 1 + Stage 2) — Q&A Log
Date: 2026-02-16

This file records the question/answer decisions gathered before implementing
the repair receiving workflow fixes. It is intentionally concise but complete.

## Q&A

1. Q: Is "real scan to B/W PDF" for web, mobile, or both?
   A: Mobile/tablet only in-app; desktop = upload only.

2. Q: What action marks "Stage 1 complete" and triggers Stage 2 to appear?
   A: A "Complete Stage 1" button. Users may return later to do Stage 2.

3. Q: Should Stage 2 auto-expand when returning later (Stage 1 complete)?
   A: Collapsed until user clicks "Start Stage 2". After starting Stage 2,
      it should default expanded going forward unless the user minimizes.

4. Q: Should clicking "Start Stage 2" be persisted?
   A: Yes, saved to DB.

5. Q: After Stage 1 complete, should Stage 1 be locked or editable?
   A: Editable later if needed.

6. Q: Piece-count mismatch prompting enforcement timing?
   A: Yes, prompt on mismatches and require user to address.

7. Q: Should completing be blocked until mismatch is corrected or exception+note?
   A: Yes. Add "Shortage" and "Overage" exception chips for piece discrepancies.

8. Q: Need a dedicated Overage chip?
   A: Yes.

9. Q: Exception chips multi-select or single-select?
   A: Multi-select.

10. Q: Notes model for exceptions: shared field or separate per exception?
    A: One shared at first for efficiency, but later refined to per-exception
       inline entry (see below).

11. Q: Exception note scope: stage-specific or shared?
    A: One shipment-level notes system (public/internal toggle like item details).

12. Q: Intake page notes types?
    A: Both Internal and Public, toggle like Item Details notes UI.

13. Q: Required exception note placement?
    A: Exception notes must be in Public (client-visible).
       Clarification: auto-matching mismatch (manifest vs expected) does NOT
       require exception notes; piece-count discrepancies do when exceptions apply.

14. Q: Stage 1 mismatch handling (Carrier vs Dock) should Shortage/Overage sync?
    A: Yes, sync live; and Shortage/Overage remain locked until mismatch corrected.

15. Q: Mis-Ship chip auto-detect or manual?
    A: Manual only (typically determined during Stage 2), but must be available
       once Stage 2 is visible because Stage 1 remains editable.

16. Q: Stage 2 mismatch (Dock vs Entry) should Shortage/Overage sync?
    A: No sync. Prompt on Stage 2 completion; require correction or exception+note.

17. Q: Entry Count definition: sum quantities or row count?
    A: Row count. Quantity refers to items inside a carton/package; each row
       represents one carton/package/piece.

18. Q: Signature required to complete Stage 1?
    A: Not required.

19. Q: Notes UI style for intake?
    A: Same as Item Details notes UI (multi-note list with filters).

20. Q: Notes storage: shipment-level or intake-only?
    A: Shipment-level.

21. Q: Exception-note enforcement UX: Notes tab vs modal?
    A: Notes tab (option A). (Later refined to inline note per exception chip.)

22. Q: Public note required for which chips?
    A: All exception chips require a client-visible exception note.

23. Q: Add a third note type "Exception"?
    A: Yes. Filters/tabs: All / Public / Internal / Exception.

24. Q: Does a generic Public note satisfy exception requirement?
    A: No. If any exception chip is selected, at least one Exception-type note
       must exist (and for per-chip notes, each selected chip needs its note).

25. Q: Carrier paperwork pieces input: manual vs auto?
    A: Manual.

26. Q: Carrier count required for Complete Stage 1?
    A: Required. Label "Carrier count". Add help icon tooltip.

27. Q: Dock count required for Complete Stage 1?
    A: Required. Label "Dock Count". Add help icon tooltip to all 3 counts.

28. Q: Stage 2 count label and editability?
    A: Label "Entry Count", read-only, computed from row count (each row = piece).

29. Q: Exception notes deletion behavior?
    A: When a chip is removed, remove the corresponding exception note(s).
       Log all add/remove activity in shipment audit/activity history.

30. Q: Exception notes per chip: one or multiple?
    A: Inline quick entry is one note per chip; can add more from the Exception
       notes tab later.

31. Q: If chip-generated exception notes, should they be tied to chip?
    A: Yes. If note added directly in Exception notes tab, it does not need a chip.

32. Q: Where should per-exception note entry appear?
    A: Inline in the Exceptions section (quick entry), but stored under Notes tab
       in Exception filter.

33. Q: Signature applies to which stage?
    A: Stage 1 carrier sign-for.

34. Q: Signature persistence and visibility?
    A: Persisted and viewable later; on both intake page and Shipment Details page.

35. Q: Signature metadata display?
    A: Show metadata and typed name if filled out.

36. Q: Driver name requirement for signature capture?
    A: Signature optional. If drawn signature is used, Driver name required.
       Typed signature alone is acceptable (or no signature at all).

37. Q: Driver name label?
    A: "Driver name".

38. Q: Signature Edit capabilities?
    A: Edit should allow switching Draw/Type and allow Clear.

39. Q: Scanner: single-page vs multi-page PDF?
    A: Multi-page scanning into a single PDF.

40. Q: Scanner quality: edge detection + manual crop adjustment?
    A: Yes, auto edge detection plus manual crop adjustment like scanner apps.

41. Q: Scanner naming prompt?
    A: No user naming. Auto-name using shipment number shown in UI + date + unique.

42. Q: Mobile scanning environment?
    A: Initially mobile web browser; native iOS/Android later.

43. Q: Mobile web capture: file-input vs in-page live camera preview?
    A: Prefer in-page live preview; accept file-input capture if needed.

44. Q: Implement now or postpone scanner?
    A: Implement now and structure for later native swap.

45. Q: Alerts and downstream effects for exceptions?
    A: Avoid double-emailing clients. Enhance existing "Shipment Received" email
       with an Exceptions section (blank when none), using tokens for exception
       types + notes. Also show exception indicator near shipment number display.

46. Q: Shipment received email formatting for exceptions?
    A: Bullet list / note-style (types + notes), not item-specific.

47. Q: Item-level flags + alert tokens needed now?
    A: Yes, implement item-level flags and alert tokens now.

48. Q: Item-level flag types (Stage 2)?
    A: Damage, Wet, Missing documents, Crushed/Torn, Other, Open.

49. Q: Flag availability level?
    A: Both shipment-level exceptions and item-level flags; shipment notes the
       exception exists; item flags specify which carton/piece.

50. Q: Shipment-level exception chip list (final confirmation)?
    A: Damage, Wet, Open, Missing Docs, Crushed/Torn, Mis-Ship, Shortage, Overage, Other.

51. Q: After an intake is completed/closed, can users return to view/edit it?
    A: Yes. The same Dock Intake page (Stage 1 + Stage 2) should remain accessible.
       It is read-only by default with an "Edit" button to unlock changes, without
       reopening the intake status or re-running the completion flow.

52. Q: Auto-generated Receiving Document PDF: when saved and how to handle re-generation?
    A: Save immediately upon Stage 2 completion. If a Receiving Document already exists,
       overwrite the visible version (keep only the latest visible) while keeping older
       versions archived (not deleted from storage).

53. Q: How do users revisit archived Receiving Document versions?
    A: Via the Activity feed. Activity should be interactive globally across the app:
       users can tap entity codes (item/shipment/etc) and documents to navigate/open them.

54. Q: Activity link rendering style (when codes appear in the text)?
    A: Inline clickable text within the sentence (option B), not separate chips under the row.

55. Q: Should the redesigned Documents field (grid thumbnails + viewer + upload/download permissions)
       be reused outside Dock Intake (e.g., Quote detail)?
    A: Yes — apply the same redesigned Documents field to the Quote detail page as well.

56. Q: Which Quote detail page should receive the redesigned Documents field?
    A: Quote Builder / Quote detail (`/quotes/:id`) (option B).

57. Q: Quote Builder currently uses a legacy "Attachments" section. Keep it or replace it?
    A: Replace it with the redesigned Documents field (option A).

58. Q: For existing quotes with legacy attachments, should we migrate/surface them in the new Documents grid?
    A: No (option B). It's fine to leave legacy attachments out since there aren't quotes with attachments in the system.

59. Q: Quote Builder Documents field permissions (and client access)?
    A: Staff only (admin + manager). Client users should not have access to the Quotes list or Quote Builder/detail pages.

60. Q: What does "Closed" mean for Dock Intake receiving?
    A: It refers to `shipments.inbound_status = 'closed'` (not the global `shipments.status`).
       This is set when Stage 2 is completed: the dock intake has been fully received,
       `received_at` is set, and the intake workflow is considered finished.

61. Q: When Stage 2 is completed, what should the shipment's visible status be, and how should "Received Today" work?
    A: Stage 2 completion should set the shipment's visible status to "received" (i.e., update `shipments.status = 'received'`).
       Intakes/shipments with `status = 'received'` should appear on the "Received Today" card when `received_at` is today.

62. Q: Quote Builder (`/quotes/:id`) Documents field: scan support or upload only?
    A: Upload only. Button UI + preview behavior should match the Intake Documents field (same look/feel and thumbnail/viewer behavior).

63. Q: Quote Builder upload-only Documents header button layout?
    A: Single full-width "Upload" button (option A).

64. Q: In Hub cards / list rows, what status label should dock intakes show after Stage 2 completion?
    A: Show "Received" (option A). ("Closed" is an internal inbound stage marker; the user-facing status should be received.)

65. Q: Hub card expanded lists: clicking a shipment row should navigate where?
    A: To the Shipment Details page (`/shipments/:id`), even for dock intakes.

66. Q: "Intakes In Progress" card: should it include dock intakes with inbound_status = closed?
    A: No (option A). Closed is not in-progress; include only draft/stage1_complete/receiving.

67. Q: "Intakes In Progress" card list: status label for those rows?
    A: Show a single label "In Progress" for all in-progress intake stages (option B).

68. Q: "Received Today" card: should it combine received dock intakes with other inbound types (expected/manifest) in one list?
    A: No (option B). Keep dock intakes separate from other inbound types.

69. Q: On the Shipments Hub, what should the "Received Today" card show?
    A: Only Dock Intakes received today (inbound_kind = dock_intake).

70. Q: On the Shipments Hub, what should the "Expected Today" card show?
    A: Expected shipments scheduled for today regardless of current status/stage (e.g., closed, pending, etc).

71. Q: What should the /shipments/received page show?
    A: Only received Dock Intakes (option B), to align with the Hub's "Received Today" card behavior.

72. Q: On /shipments/received (dock intakes only), default filter/sort?
    A: Show all received dock intakes (not limited to today) (option B) and default sort by received date (newest first).

73. Q: Should /shipments/received include quick date filters (Today/7d/30d/All)?
    A: No. Keep search + sort only.

74. Q: "Expected Today" should use which date field to determine "today"?
    A: Use `expected_arrival_date` (not eta_start/eta_end).

75. Q: "Expected Today" should include which inbound kinds?
    A: Include expected + manifests scheduled for today (option B).

76. Q: Expanding "Expected Today" list should include what?
    A: Only scheduled inbound shipments for today (expected + manifests) (option A). Do not include unlinked dock intakes.

77. Q: "Expected Today" list row click destination?
    A: Navigate to the corresponding inbound detail page (expected/manifest) (option A), not the generic Shipment Details page.

78. Q: "Received Today" (dock intakes only) list row click destination?
    A: Navigate to the Dock Intake page (`/incoming/dock-intake/:id`) (option A).

79. Q: Hub cards expanded list click behavior should be card-specific or always Shipment Details?
    A: Card-specific. Expected Today -> inbound detail pages; Intakes In Progress -> Shipment Details; Received Today -> Dock Intake page.

80. Q: "Shipped Today" should use which timestamp to determine "today"?
    A: Use `completed_at` (option A). Treat completion timestamp as the shipped timestamp for dashboard purposes.

81. Q: "Shipped Today" should include which outbound statuses?
    A: Include outbound shipments in statuses released + completed + shipped (option A), using `completed_at` window.

82. Q: "Shipped Today" expanded list row click destination?
    A: Navigate to the outbound shipment details page for the order clicked.

83. Q: Which route is the "outbound shipment details page" for shipped/outbound shipments?
    A: Use the shipment details page for that shipment (`/shipments/:id`). (User-facing: "go to the shipment details page for the OUT# clicked"; route specifics not important.)

84. Q: Tapping the "Shipped Today" card (not expanding): what should /shipments/released show?
    A: Option A — all outbound shipments in released/completed/shipped (not limited to today), default sort newest completed first, search + sort only.

85. Q: Tapping the "Received Today" card (not expanding): where should it go?
    A: Go to the Dock Intakes list page showing all intakes (not just today's received).

86. Q: Which route/page is the Dock Intakes list page?
    A: Incoming Manager (`/incoming/manager`) (option B).

87. Q: Tapping the "Intakes In Progress" card (not expanding): where should it go?
    A: Incoming Manager (`/incoming/manager`) on the intakes view (option A).

88. Q: Tapping the "Expected Today" card (not expanding): where should it go?
    A: Incoming Manager (`/incoming/manager`) on the expected view (option A).

89. Q: Tapping the "Shipped Today" card (not expanding): where should it go?
    A: `/shipments/released` (option A).

