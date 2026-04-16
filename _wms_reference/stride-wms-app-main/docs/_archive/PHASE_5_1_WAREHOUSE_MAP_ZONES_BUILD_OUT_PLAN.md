## Stride WMS Phase 5.1 — Warehouse Map + Zone-Based Capacity Intelligence

This plan is derived from:
- `Stride_WMS_Phase_5_1_NVPC_Builder_Execution_Contract.pdf`
- `Stride_WMS_Phase_5_1_Enterprise_Implementation_Contract_DEEP_TECHNICAL.pdf`

### Non‑negotiables (Hard Stops)

- **Do not modify** billing, receiving, or outbound workflows.
- **Do not replace** the existing capacity engine/math (only aggregate it).
- **No N+1**: the Heat Viewer must load zone utilization via **a single RPC call**.
- **Multi‑tenant isolation**: no cross‑tenant reads/writes; enforce via **RLS + tenant assertions in RPCs**.
- **If an existing warehouse map system exists**: stop and extend it (PF4). (Repo scan found no warehouse-map-specific implementation.)

### Repo reality notes (important for implementation)

- `locations` are scoped to a tenant through `warehouses.tenant_id` (the `locations` table does **not** carry `tenant_id` in generated types).
- `locations` has `capacity_cu_ft` and also `capacity_cuft` in types; existing UI often prefers `capacity_cuft ?? capacity_cu_ft`.
- Used capacity is already computed in the existing capacity engine via `location_capacity_cache.used_cuft` and RPCs like `rpc_get_location_capacity` (per-location).
- Phase 5.1 must **aggregate** existing capacity data (do not introduce a competing capacity model).

---

## Phase 5.1 Execution Plan (strict order)

### 0) Pre‑flight verification (must pass before writing code)

- **PF1 tables exist**: `warehouses`, `locations`
- **PF2 helper exists**: `user_tenant_id()` (or equivalent)
- **PF3 capacity fields exist**: confirm `locations.capacity_cu_ft` at minimum (and identify the canonical “used” source; in Stride this appears to be `location_capacity_cache.used_cuft`)
- **PF4 no competing map system**: search repo for `warehouse_map`, `map_editor`, `reactflow`, `konva`, `fabric`, `heatmap`

Outputs to capture (for final execution summary later):
- what was found for PF1–PF4
- where “used cu ft” comes from in this repo (likely the cache table)

---

## 1) Database schema (Supabase migration)

### 1.1 Create `warehouse_zones`

- Table: `public.warehouse_zones`
- Columns per contract: `id`, `tenant_id`, `warehouse_id`, `zone_code`, `description`, `sort_order`, `created_at`, `created_by`
- Uniqueness: `(tenant_id, warehouse_id, zone_code)`

**Implementation note**: even though `locations` lacks `tenant_id`, zones should still store `tenant_id` for isolation and for cheaper lookups.

### 1.2 Add `locations.zone_id`

- Add nullable `zone_id uuid` FK → `warehouse_zones(id)` `ON DELETE SET NULL`
- Do **not** change any existing location capacity columns or triggers.

### 1.3 Create `warehouse_maps`

- Table: `public.warehouse_maps`
- Unique `(tenant_id, warehouse_id, name)`
- One default map per `(tenant_id, warehouse_id)` enforced by partial unique index + defensive trigger

### 1.4 Create `warehouse_map_nodes`

- Table: `public.warehouse_map_nodes`
- Represents zone rectangles on the map canvas (SVG)
- Unique `(warehouse_map_id, zone_id)` where `zone_id is not null` (prevents a zone being placed twice on the same map)

### 1.5 (Out of scope) `zone_alert_state`

Zone-level (heat map) notification alerts are out of scope (DL-2026-02-18-010), so do not create a `zone_alert_state` persistence table in this phase.

### 1.6 RLS policies (tenant isolation)

- Enable RLS on all new tables.
- Policies: `tenant_id = user_tenant_id()` for select/insert/update/delete.

**Important**: for any joins to `locations`, tenant scoping must go through `warehouses.tenant_id` because `locations.tenant_id` is not present.

### 1.7 Triggers

- `set_updated_at()` for `warehouse_maps` and `warehouse_map_nodes`
- `ensure_single_default_map()` for `warehouse_maps`

---

## 2) RPCs (single-call aggregation for visualization)

### 2.1 `rpc_get_warehouse_map_zone_capacity(p_map_id uuid)`

**Contract output** (table return):
- `zone_id`, `zone_code`, `node_id`, `node_label`
- `used_cu_ft`, `capacity_cu_ft`, `free_cu_ft`, `utilization_pct`, `state`

**Tenant safety**:
- derive `v_tenant := user_tenant_id()`
- verify `warehouse_maps.id = p_map_id AND tenant_id = v_tenant`, else raise `TENANT_MISMATCH_OR_NOT_FOUND`

**Capacity parity**:
- capacity rollup: `SUM(locations.capacity_*)` (use the canonical existing column; in this repo likely `capacity_cuft` with fallback to `capacity_cu_ft`)
- used rollup: `SUM(location_capacity_cache.used_cuft)` joined by `location_id` (preferred to avoid per-location RPC calls)
- utilization: `SUM(used)/SUM(capacity) * 100`
- if capacity sum = 0 → `utilization_pct = NULL`
- state thresholds (for UI coloring only): `>=100 CRITICAL`, `>=80 WARNING`, else `NORMAL`; capacity=0 → `NO_CAPACITY`

### 2.2 (Out of scope) `rpc_evaluate_zone_alerts(p_map_id uuid)`

Zone-level/heat-map alert evaluation + notification emission is intentionally not planned in this phase (DL-2026-02-18-010). If this is revisited later, this is where the evaluation RPC would be specified.

---

## 3) Zones UI (Settings → Warehouses → Zones)

Where it likely lives in this repo:
- Settings page is `src/pages/Settings.tsx`
- Warehouses tab content is currently `WarehouseList` + `WarehouseDialog`

Plan:
- Add a Zones manager view scoped to a selected warehouse:
  - list zones: `zone_code`, `description`, `sort_order`, **# locations assigned**, actions
  - create/edit modal
  - batch generate wizard (prefix/start/count/zero-pad/preview/create)
  - delete confirmation showing:
    - # locations impacted (will be auto-unassigned)
    - # maps impacted (nodes will become unbound if `zone_id` set null via FK)
- Data access:
  - New hook `src/hooks/useWarehouseZones.ts`
  - Always filter by `warehouse_id` and derive `tenant_id` from profile for inserts.

---

## 4) Locations UI enhancements

Touchpoints:
- List: `src/components/settings/LocationsSettingsTab.tsx`
- Import: `src/components/settings/CSVImportDialog.tsx`
- Column config: `src/lib/locationListColumns.ts`

Changes:
- Add a Zone column (display `zone_code` or “—”).
- Add per-row Zone dropdown (controlled list from `warehouse_zones` for that location’s warehouse).
- Bulk assign: select rows → assign `zone_id` (single update call if possible).
- Filters:
  - “Unbound” filter (`zone_id IS NULL`) to support Map Builder “Unbound” workflow.
- Import behavior update (contract): **UPSERT on `(warehouse_id, code)`** but **blanks must not overwrite** existing values unless explicitly requested.
  - This requires building the upsert payload so that blank cells become **undefined** (omit the field) rather than `null`.
  - Add optional `zone_code` import column:
    - map `zone_code` to `zone_id` for the target warehouse
    - if blank, do not overwrite existing `zone_id` unless explicit “clear zone” mode is selected

---

## 5) Map Builder (Admin/Manager)

Route:
- `/warehouses/:warehouseId/map?mapId=<uuid>`
  - If `mapId` is omitted, load the warehouse Default Map (if present).

Behavior (contract):
- Map selector (create/rename/set default)
  - If this is the first map for the warehouse, it auto-becomes the Default Map (DL-2026-02-18-012)
- Toolbar: select, add zone rectangle, grid snap (default on), auto-label toggle, duplicate (Ctrl/Cmd+D)
- Canvas: SVG grid background, zoom/pan, drag-select multi-select, resize handles
- Right sidebar for selected rectangle: label, zone dropdown, delete rectangle, optional numeric x/y/w/h
- Autosave: debounce 300–500ms with saving/saved indicator; keep dirty state on failure
- 300 zones supported

Implementation approach (no new heavy dependencies):
- SVG canvas with pointer events + internal scene graph state:
  - nodes stored as array keyed by `id`
  - selection model (single/multi)
  - pan/zoom transform in state
  - snap-to-grid based on `warehouse_maps.grid_size`
- Persistence:
  - `warehouse_maps` record for map properties
  - `warehouse_map_nodes` for rectangles
  - use batched `upsert` for nodes on save to avoid excessive network chatter

Role gating:
- require `admin` + `manager` to access route and to write maps/nodes (DL-2026-02-15-201)

---

## 6) Heat Map Viewer (Read-only)

Route:
- `/warehouses/:warehouseId/heatmap`
  - Viewer always renders the warehouse Default Map (DL-2026-02-18-011)

Data:
- Resolve `default_map_id` for the warehouse (query `warehouse_maps` where `is_default=true`)
- **single** call: `rpc_get_warehouse_map_zone_capacity(default_map_id)`

Rendering:
- draw the same rectangles as map nodes, but fill with gradient based on utilization thresholds:
  - 0–50 green
  - 50–80 yellow/orange
  - 80–100 red
  - >100 deep red
  - capacity=0 or utilization null → gray
- legend + refresh button

Access:
- `admin` + `manager` + `warehouse` access (DL-2026-02-15-201)

---

## 7) Zone-level alerts (out of scope)

Zone utilization alerts/notifications are out of scope for this phase (DL-2026-02-18-010). The heat map remains a visual indicator; alerting remains per-location via the existing capacity alert system.

---

## 8) Verification gates (acceptance criteria)

Must pass:
- **V1** DB migrations pass
- **V2** RLS cross-tenant safety test passes (no read/write across tenant)
- **V3** zones create/edit/delete verified
- **V4** location zone assignment verified (row + bulk + import)
- **V5** map builder persistence verified (create/rename/default/nodes)
- **V6** duplicate works (Ctrl/Cmd+D)
- **V7** heat loads <2s at 300 zones (single RPC)
- **V8** heat map does not emit notification alerts from zone thresholds (by design)
- **V10** no billing regression

---

## Open questions (we’ll do one at a time)

1) Should the **Heat Viewer** be accessible to `warehouse_user`, or restricted to `tenant_admin` only?

