# Locked Decision Source — Receiving Repairs Intake Q&A (2026-02-16)

## Source metadata

- Source type: Chat Q&A (this session)
- Subject: Receiving workflow repairs (Stage 1 + Stage 2), documents/media UX, activity interactivity, and Shipments Hub card behavior
- Branch/session: `cursor/receiving-workflow-repairs-657a`
- Compiled by: cursor agent (gpt-5.3-codex-high)
- Compiled on: 2026-02-16
- Purpose: Normalize explicit Q&A decisions for ledger import

## Extraction rules used

1. Only explicit user decisions/approvals are included.
2. Duplicates are grouped under one Q&A record.
3. If later answers supersede earlier ones, both are recorded; later records should be treated as prevailing.
4. No inferred decisions are added.

## Q&A records (explicit only)

### QA-2026-02-16-001
- Question/context: Is "real scan to B/W PDF" for web, mobile, or both?
- Explicit answer/decision: Mobile/tablet only in-app; desktop = upload only.

### QA-2026-02-16-002
- Question/context: What action marks "Stage 1 complete" and triggers Stage 2 to appear?
- Explicit answer/decision: A "Complete Stage 1" button. Users may return later to do Stage 2.

### QA-2026-02-16-003
- Question/context: Should Stage 2 auto-expand when returning later (Stage 1 complete)?
- Explicit answer/decision: Collapsed until user clicks "Start Stage 2". After starting Stage 2, it should default expanded going forward unless the user minimizes.

### QA-2026-02-16-004
- Question/context: Should clicking "Start Stage 2" be persisted?
- Explicit answer/decision: Yes, saved to DB.

### QA-2026-02-16-005
- Question/context: After Stage 1 complete, should Stage 1 be locked or editable?
- Explicit answer/decision: Editable later if needed.

### QA-2026-02-16-006
- Question/context: Piece-count mismatch prompting enforcement timing?
- Explicit answer/decision: Yes, prompt on mismatches and require user to address.

### QA-2026-02-16-007
- Question/context: Should completing be blocked until mismatch is corrected or exception+note?
- Explicit answer/decision: Yes. Add "Shortage" and "Overage" exception chips for piece discrepancies.

### QA-2026-02-16-008
- Question/context: Need a dedicated Overage chip?
- Explicit answer/decision: Yes.

### QA-2026-02-16-009
- Question/context: Exception chips multi-select or single-select?
- Explicit answer/decision: Multi-select.

### QA-2026-02-16-010
- Question/context: Notes model for exceptions: shared field or separate per exception?
- Explicit answer/decision: One shared at first for efficiency, but later refined to per-exception inline entry.

### QA-2026-02-16-011
- Question/context: Exception note scope: stage-specific or shared?
- Explicit answer/decision: One shipment-level notes system (public/internal toggle like item details).

### QA-2026-02-16-012
- Question/context: Intake page notes types?
- Explicit answer/decision: Both Internal and Public, toggle like Item Details notes UI.

### QA-2026-02-16-013
- Question/context: Required exception note placement?
- Explicit answer/decision: Exception notes must be in Public (client-visible). Auto-matching mismatch (manifest vs expected) does not require exception notes; piece-count discrepancies do when exceptions apply.

### QA-2026-02-16-014
- Question/context: Stage 1 mismatch handling (Carrier vs Dock) should Shortage/Overage sync?
- Explicit answer/decision: Yes, sync live; and Shortage/Overage remain locked until mismatch corrected.

### QA-2026-02-16-015
- Question/context: Mis-Ship chip auto-detect or manual?
- Explicit answer/decision: Manual only (typically determined during Stage 2), but must be available once Stage 2 is visible because Stage 1 remains editable.

### QA-2026-02-16-016
- Question/context: Stage 2 mismatch (Dock vs Entry) should Shortage/Overage sync?
- Explicit answer/decision: No sync. Prompt on Stage 2 completion; require correction or exception+note.

### QA-2026-02-16-017
- Question/context: Entry Count definition: sum quantities or row count?
- Explicit answer/decision: Row count. Quantity refers to items inside a carton/package; each row represents one carton/package/piece.

### QA-2026-02-16-018
- Question/context: Signature required to complete Stage 1?
- Explicit answer/decision: Not required.

### QA-2026-02-16-019
- Question/context: Notes UI style for intake?
- Explicit answer/decision: Same as Item Details notes UI (multi-note list with filters).

### QA-2026-02-16-020
- Question/context: Notes storage: shipment-level or intake-only?
- Explicit answer/decision: Shipment-level.

### QA-2026-02-16-021
- Question/context: Exception-note enforcement UX: Notes tab vs modal?
- Explicit answer/decision: Notes tab (later refined to inline note per exception chip).

### QA-2026-02-16-022
- Question/context: Public note required for which chips?
- Explicit answer/decision: All exception chips require a client-visible exception note.

### QA-2026-02-16-023
- Question/context: Add a third note type "Exception"?
- Explicit answer/decision: Yes. Filters/tabs: All / Public / Internal / Exception.

### QA-2026-02-16-024
- Question/context: Does a generic Public note satisfy exception requirement?
- Explicit answer/decision: No. If any exception chip is selected, at least one Exception-type note must exist; for per-chip notes, each selected chip needs its note.

### QA-2026-02-16-025
- Question/context: Carrier paperwork pieces input: manual vs auto?
- Explicit answer/decision: Manual.

### QA-2026-02-16-026
- Question/context: Carrier count required for Complete Stage 1?
- Explicit answer/decision: Required. Label "Carrier count". Add help icon tooltip.

### QA-2026-02-16-027
- Question/context: Dock count required for Complete Stage 1?
- Explicit answer/decision: Required. Label "Dock Count". Add help icon tooltip to all 3 counts.

### QA-2026-02-16-028
- Question/context: Stage 2 count label and editability?
- Explicit answer/decision: Label "Entry Count", read-only, computed from row count (each row = piece).

### QA-2026-02-16-029
- Question/context: Exception notes deletion behavior?
- Explicit answer/decision: When a chip is removed, remove the corresponding exception note(s). Log all add/remove activity in shipment audit/activity history.

### QA-2026-02-16-030
- Question/context: Exception notes per chip: one or multiple?
- Explicit answer/decision: Inline quick entry is one note per chip; can add more from the Exception notes tab later.

### QA-2026-02-16-031
- Question/context: If chip-generated exception notes, should they be tied to chip?
- Explicit answer/decision: Yes. If note added directly in Exception notes tab, it does not need a chip.

### QA-2026-02-16-032
- Question/context: Where should per-exception note entry appear?
- Explicit answer/decision: Inline in the Exceptions section (quick entry), but stored under Notes tab in Exception filter.

### QA-2026-02-16-033
- Question/context: Signature applies to which stage?
- Explicit answer/decision: Stage 1 carrier sign-for.

### QA-2026-02-16-034
- Question/context: Signature persistence and visibility?
- Explicit answer/decision: Persisted and viewable later; on both intake page and Shipment Details page.

### QA-2026-02-16-035
- Question/context: Signature metadata display?
- Explicit answer/decision: Show metadata and typed name if filled out.

### QA-2026-02-16-036
- Question/context: Driver name requirement for signature capture?
- Explicit answer/decision: Signature optional. If drawn signature is used, Driver name required. Typed signature alone is acceptable (or no signature at all).

### QA-2026-02-16-037
- Question/context: Driver name label?
- Explicit answer/decision: "Driver name".

### QA-2026-02-16-038
- Question/context: Signature Edit capabilities?
- Explicit answer/decision: Edit should allow switching Draw/Type and allow Clear.

### QA-2026-02-16-039
- Question/context: Scanner: single-page vs multi-page PDF?
- Explicit answer/decision: Multi-page scanning into a single PDF.

### QA-2026-02-16-040
- Question/context: Scanner quality: edge detection + manual crop adjustment?
- Explicit answer/decision: Yes, auto edge detection plus manual crop adjustment like scanner apps.

### QA-2026-02-16-041
- Question/context: Scanner naming prompt?
- Explicit answer/decision: No user naming. Auto-name using shipment number shown in UI + date + unique.

### QA-2026-02-16-042
- Question/context: Mobile scanning environment?
- Explicit answer/decision: Initially mobile web browser; native iOS/Android later.

### QA-2026-02-16-043
- Question/context: Mobile web capture: file-input vs in-page live camera preview?
- Explicit answer/decision: Prefer in-page live preview; accept file-input capture if needed.

### QA-2026-02-16-044
- Question/context: Implement now or postpone scanner?
- Explicit answer/decision: Implement now and structure for later native swap.

### QA-2026-02-16-045
- Question/context: Alerts and downstream effects for exceptions?
- Explicit answer/decision: Avoid double-emailing clients. Enhance existing "Shipment Received" email with an Exceptions section (blank when none), using tokens for exception types + notes. Also show exception indicator near shipment number display.

### QA-2026-02-16-046
- Question/context: Shipment received email formatting for exceptions?
- Explicit answer/decision: Bullet list / note-style (types + notes), not item-specific.

### QA-2026-02-16-047
- Question/context: Item-level flags + alert tokens needed now?
- Explicit answer/decision: Yes, implement item-level flags and alert tokens now.

### QA-2026-02-16-048
- Question/context: Item-level flag types (Stage 2)?
- Explicit answer/decision: Damage, Wet, Missing documents, Crushed/Torn, Other, Open.

### QA-2026-02-16-049
- Question/context: Flag availability level?
- Explicit answer/decision: Both shipment-level exceptions and item-level flags; shipment notes the exception exists; item flags specify which carton/piece.

### QA-2026-02-16-050
- Question/context: Shipment-level exception chip list (final confirmation)?
- Explicit answer/decision: Damage, Wet, Open, Missing Docs, Crushed/Torn, Mis-Ship, Shortage, Overage, Other.

### QA-2026-02-16-051
- Question/context: After an intake is completed/closed, can users return to view/edit it?
- Explicit answer/decision: Yes. The same Dock Intake page (Stage 1 + Stage 2) remains accessible; read-only by default with an "Edit" button to unlock changes, without reopening intake status or re-running completion flow.

### QA-2026-02-16-052
- Question/context: Auto-generated Receiving Document PDF: when saved and how to handle re-generation?
- Explicit answer/decision: Save upon Stage 2 completion and overwrite the existing visible receiving document; keep older versions archived (not deleted from storage).

### QA-2026-02-16-053
- Question/context: How do users revisit archived Receiving Document versions and activity behavior?
- Explicit answer/decision: Via the Activity feed. Activity should be interactive globally (tap item code/shipment code/document to navigate/open).

### QA-2026-02-16-054
- Question/context: Activity link rendering style (when codes appear in the text)?
- Explicit answer/decision: Inline clickable text within the sentence (not separate chips).

### QA-2026-02-16-055
- Question/context: Should redesigned Documents field be reused outside Dock Intake (e.g., Quote detail)?
- Explicit answer/decision: Yes.

### QA-2026-02-16-056
- Question/context: Which Quote detail page should receive redesigned Documents field?
- Explicit answer/decision: Quote Builder / Quote detail (`/quotes/:id`).

### QA-2026-02-16-057
- Question/context: Quote Builder legacy "Attachments" section keep or replace?
- Explicit answer/decision: Replace it with redesigned Documents field.

### QA-2026-02-16-058
- Question/context: Existing quotes with legacy attachments migration?
- Explicit answer/decision: No migration needed (none exist).

### QA-2026-02-16-059
- Question/context: Quote Builder documents permissions / client access?
- Explicit answer/decision: Staff only (admin + manager). Clients should not have access to Quotes list or Quote Builder pages.

### QA-2026-02-16-060
- Question/context: What does "Closed" status mean (dock intake)?
- Explicit answer/decision: It refers to `shipments.inbound_status = 'closed'` (not global `shipments.status`), set on Stage 2 completion; `received_at` is set; intake workflow finished.

### QA-2026-02-16-061
- Question/context: Stage 2 completion: visible status and Received Today?
- Explicit answer/decision: Stage 2 completion should set `shipments.status = 'received'`. Received Today uses `received_at` being today.

### QA-2026-02-16-062
- Question/context: Quote Builder documents: scan support or upload-only?
- Explicit answer/decision: Upload only; UI + preview behavior should match Intake Documents.

### QA-2026-02-16-063
- Question/context: Quote Builder documents header layout (upload-only)?
- Explicit answer/decision: Single full-width "Upload" button.

### QA-2026-02-16-064
- Question/context: Status label shown in Hub/list rows after Stage 2 completion for dock intakes.
- Explicit answer/decision: Show "Received" (user-facing). ("Closed" is internal.)

### QA-2026-02-16-065
- Question/context: Hub expanded list click behavior (early answer).
- Explicit answer/decision: Expanded card shipment list row click should go to Shipment Details page (`/shipments/:id`).
- Note: Later superseded by QA-2026-02-16-079.

### QA-2026-02-16-066
- Question/context: Intakes In Progress should include closed?
- Explicit answer/decision: No. Include only draft/stage1_complete/receiving.

### QA-2026-02-16-067
- Question/context: Intakes In Progress row status label.
- Explicit answer/decision: Show a single label "In Progress" for all intake stages in that card.

### QA-2026-02-16-068
- Question/context: Received Today: combine dock intakes with other inbound receipts?
- Explicit answer/decision: No. Keep dock intakes separate.

### QA-2026-02-16-069
- Question/context: Shipments Hub "Received Today" card content.
- Explicit answer/decision: Only dock intakes received today.

### QA-2026-02-16-070
- Question/context: Shipments Hub "Expected Today" card content.
- Explicit answer/decision: Expected shipments for the day regardless of status/stage.

### QA-2026-02-16-071
- Question/context: /shipments/received page content.
- Explicit answer/decision: Only received dock intakes.

### QA-2026-02-16-072
- Question/context: /shipments/received default filter/sort.
- Explicit answer/decision: Show all received dock intakes (not limited to today); default sort newest received first.

### QA-2026-02-16-073
- Question/context: /shipments/received quick date filters.
- Explicit answer/decision: No. Search + sort only.

### QA-2026-02-16-074
- Question/context: Expected Today uses which date field?
- Explicit answer/decision: expected_arrival_date.

### QA-2026-02-16-075
- Question/context: Expected Today includes which inbound kinds?
- Explicit answer/decision: expected + manifests.

### QA-2026-02-16-076
- Question/context: Expected Today expanded list includes what?
- Explicit answer/decision: Only scheduled inbound shipments for today (expected + manifests). Do not include unlinked dock intakes.

### QA-2026-02-16-077
- Question/context: Expected Today row click destination.
- Explicit answer/decision: Navigate to inbound detail pages (expected/manifest), not generic Shipment Details.

### QA-2026-02-16-078
- Question/context: Received Today (dock intakes) row click destination.
- Explicit answer/decision: Navigate to Dock Intake page (`/incoming/dock-intake/:id`).

### QA-2026-02-16-079
- Question/context: Hub expanded list click behavior should be card-specific or always Shipment Details.
- Explicit answer/decision: Card-specific: Expected Today -> inbound detail; Intakes In Progress -> Shipment Details; Received Today -> Dock Intake page.

### QA-2026-02-16-080
- Question/context: Shipped Today "today" timestamp.
- Explicit answer/decision: Use completed_at; treat completion timestamp as shipped timestamp for dashboard purposes.

### QA-2026-02-16-081
- Question/context: Shipped Today outbound status scope.
- Explicit answer/decision: Include released + completed + shipped.

### QA-2026-02-16-082
- Question/context: Shipped Today row click destination.
- Explicit answer/decision: Navigate to outbound shipment details page for the order clicked.

### QA-2026-02-16-083
- Question/context: Which route is outbound shipment details page?
- Explicit answer/decision: Use shipment details (`/shipments/:id`) for the OUT# clicked.

### QA-2026-02-16-084
- Question/context: Tapping Shipped Today card (not expanding): /shipments/released behavior.
- Explicit answer/decision: Show all outbound in released/completed/shipped (not limited to today), default newest completed first, search + sort only.

### QA-2026-02-16-085
- Question/context: Tapping Received Today card (not expanding): where should it go?
- Explicit answer/decision: Go to dock intakes list page showing all intakes.

### QA-2026-02-16-086
- Question/context: Dock intakes list page route.
- Explicit answer/decision: Incoming Manager (`/incoming/manager`).

### QA-2026-02-16-087
- Question/context: Tapping Intakes In Progress card (not expanding): where should it go?
- Explicit answer/decision: Incoming Manager (`/incoming/manager`) on intakes view.

### QA-2026-02-16-088
- Question/context: Tapping Expected Today card (not expanding): where should it go?
- Explicit answer/decision: Incoming Manager (`/incoming/manager`) on expected view.

### QA-2026-02-16-089
- Question/context: Tapping Shipped Today card (not expanding): where should it go?
- Explicit answer/decision: `/shipments/released`.

