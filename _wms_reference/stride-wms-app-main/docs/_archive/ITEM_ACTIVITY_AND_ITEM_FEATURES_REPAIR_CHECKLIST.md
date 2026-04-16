# Item Activity + Item Features — Repair & Enhancement Checklist

Branch: `cursor/activity-system-and-item-features-9847`  
Last updated: 2026-02-18

## Status legend

- ✅ Complete
- ⬜ Pending / not complete
- 🟨 Partially done (some work landed, full requirement not met)

## Checklist

| # | Item | Status | Evidence (commit / notes) |
|---:|------|:------:|---------------------------|
| 1 | Remove **History** tab from Item Details (merge unique history into Activity) | ✅ | `51d70be` |
| 2 | Redesign Item **Activity** tab filter UI (single filter icon + multi-select) | ✅ | `51d70be` |
| 3 | Ensure Item Activity logs **all activity** (expand logging + derived legacy events) | ✅ | `51d70be` (+ follow-up logging commits on branch) |
| 4 | Add Activity log to major entity pages (Manifest/Expected/Outbound/Tasks/Claims/RepairQuotes/Quotes/Invoices/Stocktakes) and rebrand Manifest “Audit History” → “Activity” | ✅ | Entity feed standardized multi-select filters + comprehensive sources for Claims/Quotes/Repair Quotes/Stocktakes (`a99394f`), Stocktake Scan + Claim tab label (`c5b419c`). Earlier Manifest rebrand + shipment feeds: `1431893`. |
| 5 | Remove **Advanced** tab from Item Details; keep custom field values editable inline | ✅ | `51d70be` |
| 6 | Fix mobile tabs row formatting (horizontal scroll pill bar) | ✅ | `06ec41f` |
| 7 | Fix flag pill/badge formatting consistency | ✅ | `b99a8e8` |
| 8 | Add **Size** to Item Fields in Settings/Preferences (BUILTIN_ITEM_COLUMNS) | ✅ | `211f226` |
| 9 | Classes editor: single “Cubic Feet” size per class (persist to both min/max) | ✅ | `0b26777` |
| 10 | Auto-populate item `size` from class assignment; prompt on overwrite; default `size_unit` to `cu_ft` | ✅ | `e3b45fb` |
| 11 | Column visibility + reorder controls on all item list pages (Inventory/Manifest/Expected/Outbound/Stocktake detail) | ✅ | Inventory (`cb2f16c`), ShipmentDetail/TaskDetail (`677a3a6`), ManifestDetail (`cfe0eb7`), OutboundCreate (`6ea7b1e`), StocktakeScanView (`641382f`), ExpectedShipmentDetail (`28dce23`). |

## Context notes / decisions

- **Class size fields**: UI is a single “Cubic Feet” value per class; persisted by writing the same number to both `classes.min_cubic_feet` and `classes.max_cubic_feet` for backward compatibility.
- **Item size auto-fill**: when class changes, item `size` is auto-filled from class cubic feet and `size_unit` defaults to `cu_ft`. If the user manually edited size, the UI prompts before overwriting.

