# QR Scanner Next Phase — Build Plan (Archived)

> **Status:** PLANNED, not started. Features A + B are independent and can ship in either order.

---

## Feature A: Scanner Supabase Direct Lookup

### Problem

- Current scanner item lookup uses a CacheService index that rebuilds by opening every active client spreadsheet
- N clients = N `SpreadsheetApp.openById()` calls (3-30s depending on client count)
- Index stored in 90KB CacheService chunks with 6-hour TTL
- Single cache miss triggers a full rebuild of the entire index
- Supabase Phase 3 already mirrors all inventory data into the `inventory` table (~50ms queries)

### Solution

- Scanner HTML loads `@supabase/supabase-js` via CDN (same version as React app)
- New `lookupItemSupabase(itemId)` function queries `inventory` table directly
- Supabase URL + publishable key stored in localStorage (alongside existing `GS_SCANNER_API_URL`)
- Setup modal gets a Supabase URL field (or auto-detect from shared config)
- Falls back to existing GAS `lookupItem` API if Supabase is unavailable or fails
- Bulk lookup: single `SELECT * FROM inventory WHERE item_id IN (...)`

### What changes

- `Scanner.fixed.html` + `index.updated.html`: add Supabase JS CDN, `lookupItemSupabase()`, config UI
- `ScannerBackend.updated.gs`: no changes needed (GAS fallback stays as-is)
- `IndexBuilder.updated.gs`: no changes needed (kept as fallback, scheduled rebuild can be disabled later)

### What stays the same

- `qrUpdateLocations` still goes through GAS (writes to Google Sheets)
- Label Printer unchanged (labels don't need item lookup — data comes from paste or `getItemsForLabels`)
- Move history logging unchanged (GAS-side)
- All existing scanner move flows unchanged

### Locked decisions

1. Supabase direct from browser (not GAS proxy) — fastest path (~50ms)
2. Publishable key only (not service role key) — safe for browser
3. GAS fallback if Supabase fails — graceful degradation
4. CacheService index kept as fallback initially — can be deprecated later

---

## Feature B: Auto-Print Labels from Receiving

### Problem

- After completing a shipment on the Receiving page, user must manually go to Label Printer, paste item IDs, generate labels, then print
- For high-volume receiving (10-30 items per shipment), this manual step wastes time
- Label data is already available in the Receiving page state after API success

### Solution

- Checkbox on Receiving page: "Auto-print labels on complete" (default OFF)
- Toggle persisted to localStorage per browser
- After successful `postCompleteShipment()`:
  1. If toggle is OFF → show success screen as normal (no change)
  2. If toggle is ON → render labels in a hidden print div → `window.print()` → then show success screen
- Label data comes from `filledItems` state (already in memory): itemId, vendor, description, location, sidemark, class, client name
- QR codes generated client-side using qrcodejs CDN (same lib as Label Printer)
- Print CSS: `@media print` hides everything except label div, page-break per label card
- Uses same 4x6 label layout and CSS as existing Label Printer (hardcoded for v1)

### What changes

- `stride-gs-app/src/pages/Receiving.tsx`:
  - Add "Auto-print labels" checkbox near Submit button (localStorage-persisted)
  - Add hidden `#print-labels` div for label rendering
  - Add qrcodejs CDN script tag (or npm package)
  - After `postCompleteShipment` success + toggle ON: build label HTML from `filledItems`, generate QR codes, `window.print()`, then set `submitted=true`
  - Print CSS (`@media print`) to isolate label output

### What stays the same

- Receiving form behavior unchanged
- `postCompleteShipment` API call unchanged
- Success screen unchanged (labels print BEFORE success screen shows)
- Label Printer standalone page unchanged (still works independently)
- No backend changes needed

### Locked decisions

1. Toggle on Receiving page itself (not in Settings) — most discoverable
2. Default OFF — turn on when ready to roll out printing
3. Inline rendering in Receiving page (not new tab or shared module) — simplest v1
4. 4x6 label layout hardcoded for v1 (configurable label size is a future enhancement)
5. Label data from `filledItems` state (no additional API call needed)
6. QR payload format: `ITEM:{itemId}` (same as Label Printer)

---

## Build order

- **Phase 1:** Feature A (Supabase lookup) — scanner-only change, no React app collision risk
- **Phase 2:** Feature B (auto-print) — Receiving.tsx change, coordinate with other builders

## Coordination notes

- Feature B touches Receiving.tsx — check for other builder changes before starting
- Feature A only touches scanner HTML files — safe to build independently
- Both features are independent of each other — can be built in either order
