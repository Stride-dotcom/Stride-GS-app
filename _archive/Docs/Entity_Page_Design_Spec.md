# Entity Page Redesign — Design Spec (LOCKED)

> Session 80+. Replacing slide-out detail panels with full-page entity views. Design is locked — do not deviate.

## Visual Language

| Token | Theme value | Usage |
|---|---|---|
| Page background | `theme.v2.colors.bgPage` (#F5F2EE) | Warm beige — all entity pages |
| Tab bar background | `theme.v2.colors.bgDark` (#1C1C1C) | Dark strip containing tab cards |
| Active tab | `theme.colors.orange` bg, `#fff` text | Orange filled card |
| Inactive tab | transparent bg, `rgba(255,255,255,0.55)` text | Muted white text on dark |
| Notification dot | `theme.colors.statusRed` (red) | Small dot on tab label when unread content |
| Sub-tab pills | active: `theme.colors.orange` bg; inactive: `rgba(255,255,255,0.1)` bg | Inside Photos/Notes/Activity for source filter |
| Content cards | `theme.colors.bgCard` bg, `theme.radii.xl` radius | White cards on beige page |
| Field labels | `theme.colors.orange`, `theme.typography.sizes.xs`, 500 weight, uppercase | Above every field value |
| Footer bar bg | `theme.v2.colors.bgDark` | Slim sticky bottom bar |
| Footer primary CTA | `theme.colors.orange` bg, `#fff` text | Right-aligned |
| Footer secondary | `rgba(255,255,255,0.12)` bg, `#fff` text | Left-aligned |

## Layout

- **Single column**, full-width, no max-width
- **Header — 2 rows (compact)**:
  - Row 1: `← Back` button + entity type label (e.g. "INVENTORY") + entity ID (large, bold) + status badge
  - Row 2: Client name · Sidemark · field badges (Vendor, Class, Location pills)
- **Header right**: Edit toggle (pencil icon) + overflow Actions dropdown (Resend Email, View in Inventory, etc.)
- **No summary strip** at the top of the page — content starts immediately with the header.
- **Tab bar**: sticky on desktop (`position: sticky; top: 0; z-index: 10`, `min-width: 768px`). On mobile, tabs **scroll with the page** (not sticky) and the tab row scrolls horizontally. Dark background, tabs are rectangular cards with 8px radius.
- **Tab body**: White cards, 16px padding, gap between cards 12px
- **Sticky bottom bar**: `position: sticky; bottom: 0; background: theme.v2.colors.bgDark`. Left: secondary quick-action buttons (Create Task, Repair Quote, Add to WC, etc.). Right: primary state-aware CTA. Height: 56px.

## Back button & URL behavior

- **Back button uses browser history** (`navigate(-1)`) — goes back to wherever the user came from (Dashboard, entity list, another entity page). Does NOT hardcode a route.
- **URL state preservation**: list pages (Inventory, Tasks, Repairs, WillCalls, Shipments) encode client filter + sort state in the URL. When the user navigates to an entity page and presses Back, the browser restores the exact previous URL — client filter, sort column, and scroll position all come back automatically via URL params.
- **Pages are bookmarkable and shareable** — the full URL `#/inventory/62391?client=<sheetId>` always resolves to the correct entity for any user with access.
- **Client filter sync**: `useClientFilterUrlSync` keeps `?client=<sheetId>` in the URL. The `backTo` prop on EntityPage is not used — always use `navigate(-1)`.

## Entity ID deep links

- **All entity IDs are clickable orange links** (`theme.colors.orange`) throughout the app — in history sections, task/repair/WC cards, shipment references, notes, etc.
- Clicking any entity ID navigates to that entity's full page: Item IDs → `#/inventory/:id`, Task IDs → `#/tasks/:id`, Repair IDs → `#/repairs/:id`, WC numbers → `#/will-calls/:id`, Shipment numbers → `#/shipments/:id`.
- Use the existing `buildDeepLink()` utility for constructing these links.

## Edit mode

- **Edit mode is per-card, toggled by an Edit button on each card** — not inline editing.
- Pencil icon in the card header activates edit mode for that card only. Other cards stay in read mode.
- Save / Cancel buttons appear within the card while editing.
- The header-level Edit toggle (pencil icon) is for the Details tab overall if a card-level toggle isn't appropriate. **No inline cell editing** on entity pages.

## Quick actions placement

- **Quick actions (Create Task, Repair Quote, Add to Will Call, etc.) live in the bottom bar only** — as secondary buttons on the left side.
- **Do NOT put quick action cards or buttons on the Details tab itself.**
- **Resend Email, View in Inventory, and other navigation/utility actions** go in the **Actions dropdown menu** (overflow `⋯` button in the header right slot) — not on any tab.

## State-aware bottom bar

- The bottom bar primary CTA **changes based on entity status** (not static):
  - Task: Open → "Start Task"; In Progress → "Pass" / "Fail"; Completed → "Reopen" (link)
  - Repair: Pending Quote → "Send Quote" + `$amount` input; Quote Sent → "Approve" / "Decline"; Approved → "Start Repair"; In Progress → "Pass" / "Fail"
  - Will Call: Active → "Release All Items"; partial → "Release Some"
  - Item: always "Edit Item" as primary; quick actions (Create Task, Add to WC) as secondary
  - Shipment: "Close" only (read-mostly)
- Secondary buttons (left side) are also state-aware — e.g. "Cancel Task" only shows when Open/In Progress.

## Will Call — items table

- Will Call Details tab includes an **items table with checkboxes** for partial release selection.
- Columns: checkbox, Item ID + badges, Description, Vendor, Location, Qty, Released status.
- Checkbox selection drives "Release Selected" footer action.
- COD payment section: bold text showing `$amount`. **COD button pulses** (CSS animation) when payment is required and not yet collected — orange pulse matching `theme.colors.orange`. Stops pulsing once paid.

## Drive folder buttons

- **Legacy Drive folder buttons** (Task Folder, Shipment Folder, Photos Folder) **only render when a URL exists** — check `task.folderUrl`, `item.shipmentFolderUrl`, etc. before rendering. Never show a disabled/empty folder button.
- Folder buttons live in the Photos tab or Docs tab (whichever is most relevant), not on the Details card.

## Notes tab — item notes rule

- **Item notes field does NOT appear on the Details tab.** All notes (item notes, task notes, internal notes) live in the Notes tab only.
- Details tab shows only structured fields: Vendor, Class, Location, Qty, Sidemark, Room, Reference, dates.

## Client loading — no empty state

- **All entity pages load all accessible clients by default.** There is no "select a client first" empty state on entity pages.
- The client is resolved from the entity's `tenant_id` / `clientSheetId` — entity pages is always scoped to one specific entity and its client.

## Tabs per entity

| Tab | Photos | Notes | Docs | Activity | Entity-specific |
|---|---|---|---|---|---|
| **Item** | EntitySourceTabs (All/Item/Task/Repair) | EntitySourceTabs | yes | Filter pills (All/Shipment/Tasks/Repairs/WC/Billing) | Details, Coverage |
| **Task** | EntitySourceTabs (if itemId) | EntitySourceTabs (if itemId) | yes | Filter pills (All/Status/Field Changes) | Details |
| **Repair** | EntitySourceTabs (if itemId) | EntitySourceTabs (if itemId) | yes | Filter pills | Details |
| **Will Call** | — | — | yes | Filter pills | Details, Items |
| **Shipment** | — | — | yes | Filter pills | Details, Items |

## Activity filter pills

The Activity tab in EntityPage shows `EntityHistory` entries with optional filter pills above:
- "All", "Status Changes", "Field Updates", "Created" (map to action types from `entity_audit_log`)
- Pills: same sub-tab pill style (dark/orange), `font-size: 11px`

## URL routes

```
#/inventory/:itemId
#/tasks/:taskId
#/repairs/:repairId
#/will-calls/:wcNumber
#/shipments/:shipmentNo
```

## Shared shell: EntityPage.tsx

`src/components/shared/EntityPage.tsx` — the new full-page shell (NOT TabbedDetailPanel, which is for slide-out panels). Ports the `builtInTabs` pattern (Photos/Docs/Notes/Activity) with the new dark tab bar visual. Five entity configs plug into it.
