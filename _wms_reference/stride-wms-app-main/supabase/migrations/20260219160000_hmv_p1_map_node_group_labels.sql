-- =============================================================================
-- HMV-P1: Map Builder "Groups" support (group labels on map nodes)
-- =============================================================================
-- Adds:
-- - public.warehouse_map_nodes.group_label (nullable text)
--
-- Notes:
-- - Groups are a lightweight, user-defined labeling mechanism (DL-2026-02-18-004/005).
-- - We store membership directly on nodes to avoid additional tables for phase 1.
-- =============================================================================

ALTER TABLE public.warehouse_map_nodes
  ADD COLUMN IF NOT EXISTS group_label TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_map_nodes_map_group_label
  ON public.warehouse_map_nodes (warehouse_map_id, group_label)
  WHERE group_label IS NOT NULL;

