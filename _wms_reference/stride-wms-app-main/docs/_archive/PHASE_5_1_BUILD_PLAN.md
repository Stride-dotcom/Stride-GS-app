# Phase 5.1 Build Plan — Warehouse Map + Zone-Based Capacity Intelligence

**Generated**: 2026-02-15  
**Branch**: `cursor/project-build-plan-33ba`  
**Source Contracts**:
- `Stride_WMS_Phase_5_1_NVPC_Builder_Execution_Contract.pdf`
- `Stride_WMS_Phase_5_1_Enterprise_Implementation_Contract_DEEP_TECHNICAL.pdf`

---

## 1. Pre-Flight Audit Results

| Check | Status | Notes |
|-------|--------|-------|
| **PF1** — `warehouses` table exists | PASS | `src/integrations/supabase/types.ts` confirms `warehouses` with `tenant_id`, `id`, `name`, `code`, etc. |
| **PF1** — `locations` table exists | PASS | `src/integrations/supabase/types.ts` confirms `locations` with `warehouse_id`, `code`, `capacity_cu_ft`, etc. |
| **PF2** — `user_tenant_id()` helper exists | PASS | Confirmed in multiple migration files (e.g., `20260212160000`, `20260212170000`) |
| **PF3** — `locations.capacity_cu_ft` exists | PASS | Present in types and migrations |
| **PF3** — `locations.used_cu_ft` exists | **DEVIATION** | Column does NOT exist on `locations`. Used capacity is tracked in `location_capacity_cache.used_cuft` |
| **PF4** — No competing map system | PASS | No `warehouse_map`, `map_editor`, `reactflow`, `konva`, `fabric` found in relevant source files |

---

## 2. Critical Schema Deviations from Contract

The contract's SQL and RPC definitions assume certain columns that don't exist in the current schema. These must be adapted:

### Deviation 1: `locations` does NOT have `tenant_id`

**Contract assumes**: `l.tenant_id = v_tenant` in the RPC  
**Reality**: `locations` has no `tenant_id` column. Tenant scoping is done through `locations.warehouse_id → warehouses.tenant_id`.  
**Impact**: The RPC `rpc_get_warehouse_map_zone_capacity` must join through `warehouses` to validate tenant, OR we scope by `warehouse_id` directly (since the map already identifies the warehouse).  
**Proposed fix**: In the RPC, since we already resolve `v_wh` (warehouse_id) from the map, we scope locations by `l.warehouse_id = v_wh` instead of `l.tenant_id = v_tenant`. The warehouse itself is already tenant-verified.

### Deviation 2: `locations` does NOT have `used_cu_ft`

**Contract assumes**: `l.used_cu_ft` in the capacity rollup  
**Reality**: Used capacity lives in `location_capacity_cache.used_cuft` (separate table).  
**Impact**: The RPC rollup query must LEFT JOIN `location_capacity_cache` on `location_id` to get used capacity.  
**Proposed fix**: Replace `l.used_cu_ft` with `coalesce(lcc.used_cuft, 0)` from the joined `location_capacity_cache lcc`.

### Deviation 3: `locations.capacity_cu_ft` naming

**Contract assumes**: `l.capacity_cu_ft`  
**Reality**: Both `capacity_cu_ft` and `capacity_cuft` exist on `locations` (from different migrations).  
**Impact**: Minor — we'll use `coalesce(l.capacity_cu_ft, l.capacity_cuft, 0)` to handle both columns.

---

## 3. Build Phases (Strict Execution Order)

### Phase A: Database Layer (Migration)

**Estimated files**: 1 SQL migration file

| Step | Description | Dependencies |
|------|-------------|--------------|
| A1 | Create `warehouse_zones` table with unique index on `(tenant_id, warehouse_id, zone_code)` | None |
| A2 | Add `locations.zone_id` (nullable FK → `warehouse_zones.id`, ON DELETE SET NULL) | A1 |
| A3 | Create `warehouse_maps` table with unique indexes for name and single-default | None |
| A4 | Create `warehouse_map_nodes` table with unique index for map+zone binding | A1, A3 |
| A5 | Enable RLS on all new tables with CRUD policies using `user_tenant_id()` | A1–A4 |
| A7 | Create `set_updated_at()` trigger function (if not exists) + triggers on `warehouse_maps` and `warehouse_map_nodes` | A3, A4 |
| A8 | Create `ensure_single_default_map()` trigger on `warehouse_maps` | A3 |
| A9 | Create `rpc_get_warehouse_map_zone_capacity(p_map_id uuid)` — adapted for schema deviations | A1–A4 |

### Phase B: TypeScript Types Update

**Estimated files**: 1 file modified

| Step | Description | Dependencies |
|------|-------------|--------------|
| B1 | Regenerate or manually add types for `warehouse_zones`, `warehouse_maps`, `warehouse_map_nodes` to `src/integrations/supabase/types.ts` | Phase A |
| B2 | Add `zone_id` to `locations` Row/Insert/Update types | Phase A |

### Phase C: Hooks Layer

**Estimated files**: 4 new hook files

| Step | Description | Dependencies |
|------|-------------|--------------|
| C1 | Create `src/hooks/useWarehouseZones.ts` — CRUD for zones, batch generate | Phase B |
| C2 | Create `src/hooks/useWarehouseMaps.ts` — CRUD for maps, set default, duplicate | Phase B |
| C3 | Create `src/hooks/useWarehouseMapNodes.ts` — CRUD for map nodes, autosave | Phase B |
| C4 | Create `src/hooks/useWarehouseMapZoneCapacity.ts` — calls `rpc_get_warehouse_map_zone_capacity` for heat viewer data | Phase B |

### Phase D: UI — Zones Management (Settings → Warehouses → Zones)

**Estimated files**: 3–4 new component files, 1–2 modified

| Step | Description | Dependencies |
|------|-------------|--------------|
| D1 | Create `src/components/warehouses/ZonesTable.tsx` — zone_code, description, sort_order, #locations, actions | C1 |
| D2 | Create `src/components/warehouses/AddZoneModal.tsx` — zone_code (required), description, sort_order | C1 |
| D3 | Create `src/components/warehouses/BatchGenerateZonesWizard.tsx` — prefix, start, count, zero-pad, preview | C1 |
| D4 | Create `src/components/warehouses/DeleteZoneModal.tsx` — impact count, confirm | C1 |
| D5 | Wire zones into Settings → Warehouses tab or as sub-tab | D1–D4 |

### Phase E: UI — Locations Enhancement

**Estimated files**: 1–2 modified files

| Step | Description | Dependencies |
|------|-------------|--------------|
| E1 | Add zone dropdown to `LocationsSettingsTab.tsx` — controlled list from `warehouse_zones` | C1 |
| E2 | Add bulk zone assign — select rows → assign `zone_id` | E1 |
| E3 | Add "Unbound" filter — `zone_id IS NULL` filter option | E1 |
| E4 | Update CSV/Excel import to support `zone_id` upsert on `(tenant_id, warehouse_id, location_code)` | E1 |

### Phase F: UI — Map Builder (Admin Only)

**Estimated files**: 5–8 new component files, 1–2 modified

| Step | Description | Dependencies |
|------|-------------|--------------|
| F1 | Create `src/pages/WarehouseMapBuilder.tsx` — route page component | C2, C3 |
| F2 | Create `src/components/warehouse-map/MapCanvas.tsx` — SVG canvas with grid, zoom/pan, drag-select | F1 |
| F3 | Create `src/components/warehouse-map/MapToolbar.tsx` — select, add zone rect, grid snap, auto-label, duplicate | F1 |
| F4 | Create `src/components/warehouse-map/MapHeader.tsx` — map selector, create/rename/set default (first map auto-default: DL-2026-02-18-012), heat viewer link | C2 |
| F5 | Create `src/components/warehouse-map/NodeSidebar.tsx` — label, zone dropdown, delete, x/y/w/h | C3 |
| F6 | Implement autosave with debounce (300–500ms) + saving/saved indicator | C3 |
| F7 | Implement duplicate (Ctrl/Cmd+D) and row helpers | F2 |
| F8 | Add route `/warehouses/:warehouseId/map` to `App.tsx` (admin only) | F1 |

### Phase G: UI — Heat Map Viewer (Read-Only)

**Estimated files**: 2–3 new component files, 1 modified

| Step | Description | Dependencies |
|------|-------------|--------------|
| G1 | Create `src/pages/WarehouseHeatMap.tsx` — route page component | C4 |
| G2 | Create `src/components/warehouse-map/HeatMapCanvas.tsx` — SVG with gradient fill zones | C4 |
| G3 | Create `src/components/warehouse-map/HeatMapLegend.tsx` — fixed thresholds (green/yellow/orange/red/deep red/gray) | G2 |
| G4 | Resolve warehouse Default Map, then single call `rpc_get_warehouse_map_zone_capacity(default_map_id)` on load + refresh button (DL-2026-02-18-011) | C4 |
| G5 | Add route `/warehouses/:warehouseId/heatmap` to `App.tsx` | G1 |

### Phase H: (Out of scope) Zone-level alert integration

Zone/heat-map notification alerts are intentionally out of scope (DL-2026-02-18-010). Heat map remains a visualization; alerting remains per-location via existing capacity alerts.

---

## 4. Questions Requiring Confirmation Before Build

### Q1: `locations.tenant_id` — Should we add it?

The contract's RPC SQL references `l.tenant_id` on locations, but the column doesn't exist. Two options:
- **(A)** Add `tenant_id` to `locations` (breaking change, requires backfill from `warehouses.tenant_id`) — matches contract exactly
- **(B)** Adapt the RPC to scope through `warehouse_id` (already resolved from the map) — no schema change to locations

**Recommendation**: Option B — it preserves backward compatibility (Parity Rule 5) and existing migrations explicitly document that `locations` scopes through `warehouses.tenant_id`.

### Q2: `used_cu_ft` Source — Use `location_capacity_cache`?

The contract references `locations.used_cu_ft` which doesn't exist. The actual used capacity lives in `location_capacity_cache.used_cuft`.
- **(A)** Add `used_cu_ft` column directly to `locations` and keep it in sync — doubles the data
- **(B)** Join `location_capacity_cache` in the RPC — uses existing system

**Recommendation**: Option B — it uses the existing capacity tracking system without duplicating data.

### Q3: Where should the Zones UI live?

The contract says "Settings → Warehouses → Zones". Options:
- **(A)** New sub-tab within the existing Warehouses section on the Settings page
- **(B)** New "Zones" tab on the Settings page (alongside Warehouses, Locations)
- **(C)** Within each warehouse detail/edit dialog

**Recommendation**: Option A — add a zones panel within the warehouse detail, or a sub-tab on the Settings → Warehouses section, so zones are contextually tied to their warehouse.

### Q4: Navigation Entry Points for Map Builder / Heat Map

How should users navigate to the Map Builder and Heat Map?
- **(A)** Buttons on the Warehouses section in Settings
- **(B)** New sidebar navigation entries
- **(C)** Both — sidebar entries + contextual buttons in warehouse settings

**Recommendation**: Option C — a "Warehouse Map" or "Capacity Map" sidebar entry for primary navigation, plus quick-access buttons in the warehouse settings section.

### Q5: SVG Canvas Library

The Map Builder requires an interactive SVG canvas with zoom/pan, drag-select, resize handles, etc. Options:
- **(A)** Build with raw SVG + custom mouse/touch handlers (zero dependencies)
- **(B)** Use a lightweight library like `react-zoom-pan-pinch` for the viewport, with custom SVG for rectangles
- **(C)** Use React DnD or similar for drag handling

**Recommendation**: Option A with selective use of Option B — raw SVG for the drawing surface with `react-zoom-pan-pinch` for viewport controls keeps the dependency count low while providing smooth interactions.

### Q6: Supabase Type Generation

Currently the TypeScript types in `src/integrations/supabase/types.ts` appear to be auto-generated. For adding new table types:
- **(A)** Run `supabase gen types typescript` after migration (requires Supabase CLI + DB access)
- **(B)** Manually add the type definitions to the types file

**Recommendation**: Option B for now (manual addition) — since we don't have Supabase CLI access in this environment. The types can be regenerated later.

---

## 5. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Schema deviation breaks RPC logic | High | Adapt RPC to use `location_capacity_cache` + warehouse-scoped joins |
| Map Builder SVG performance at 300 zones | Medium | Use `requestAnimationFrame`, minimize re-renders, test early |
| Autosave race conditions | Medium | Debounce + queue saves, show dirty state on error |
| Heat map color gradient accessibility | Low | Fixed thresholds with distinct colors, gray for null/zero |
| RLS policies on new tables block operations | Medium | Thorough testing of all CRUD through Supabase client |

---

## 6. Files to Create (Estimated)

### New Files
| File | Phase |
|------|-------|
| `supabase/migrations/2026MMDD_phase5_1_warehouse_zones_maps.sql` | A |
| `src/hooks/useWarehouseZones.ts` | C |
| `src/hooks/useWarehouseMaps.ts` | C |
| `src/hooks/useWarehouseMapNodes.ts` | C |
| `src/hooks/useWarehouseMapZoneCapacity.ts` | C |
| `src/components/warehouses/ZonesTable.tsx` | D |
| `src/components/warehouses/AddZoneModal.tsx` | D |
| `src/components/warehouses/BatchGenerateZonesWizard.tsx` | D |
| `src/components/warehouses/DeleteZoneModal.tsx` | D |
| `src/pages/WarehouseMapBuilder.tsx` | F |
| `src/components/warehouse-map/MapCanvas.tsx` | F |
| `src/components/warehouse-map/MapToolbar.tsx` | F |
| `src/components/warehouse-map/MapHeader.tsx` | F |
| `src/components/warehouse-map/NodeSidebar.tsx` | F |
| `src/pages/WarehouseHeatMap.tsx` | G |
| `src/components/warehouse-map/HeatMapCanvas.tsx` | G |
| `src/components/warehouse-map/HeatMapLegend.tsx` | G |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `src/integrations/supabase/types.ts` | B | Add types for 3 new tables + `zone_id` on locations |
| `src/components/settings/LocationsSettingsTab.tsx` | E | Zone dropdown, bulk assign, unbound filter |
| `src/App.tsx` | F, G | Add routes for map builder and heat map |

---

## 7. Hard Stop Reminders (from Contract)

- **DO NOT** modify billing system
- **DO NOT** modify receiving workflows
- **DO NOT** modify outbound workflows
- **DO NOT** replace existing capacity math (we extend via `location_capacity_cache`)
- **DO NOT** make per-zone or per-location HTTP calls (single RPC per heat refresh)
- **DO NOT** allow cross-tenant read/write (RLS on all tables)
- Zones remain an **optional** feature
- Zone-level alert notifications are out of scope (DL-2026-02-18-010)

---

## 8. Proposed Execution Timeline

| Order | Phase | Description | Est. Complexity |
|-------|-------|-------------|-----------------|
| 1 | A | DB Migration (tables, RLS, triggers, RPCs) | High |
| 2 | B | TypeScript types update | Low |
| 3 | C | Hooks layer (4 hooks) | Medium |
| 4 | D | Zones management UI | Medium |
| 5 | E | Locations enhancement | Low-Medium |
| 6 | F | Map Builder | High |
| 7 | G | Heat Map Viewer | Medium |
| 8 | H | (Out of scope) Zone-level alert integration | - |

---

*Awaiting confirmation on Questions Q1–Q6 before beginning implementation.*
