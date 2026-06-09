-- Quote Tool service categorization swap (service_catalog data change)
--
-- Request: in the Quote Tool's "Items & Services by Class" matrix, replace
-- Restock with Warehouse Assembly; move Restock down into the "Other Services"
-- section under the Warehouse group.
--
-- The Quote Tool is fully data-driven from public.service_catalog:
--   * "Items & Services by Class" matrix  = rows with show_in_matrix = true
--   * "Other Services" section            = rows with show_in_matrix = false,
--                                           grouped by `category`
-- So this is purely a flag/category change — no UI code touches it.
--
-- 1) Restock (RSTK): drop out of the matrix. Its category is already
--    'Warehouse', so once show_in_matrix flips off it renders in Other
--    Services under the Warehouse group (the "Warehouse Services" the
--    request refers to — the category CHECK constraint allows 'Warehouse',
--    not a literal 'Warehouse Services').
UPDATE public.service_catalog
SET show_in_matrix = false
WHERE code = 'RSTK';

-- 2) Assembly (ASM): this is already a class_based / per_class service with
--    full per-class rates (XS..XXL), so it slots straight into the matrix.
--    Surface it in the matrix, recategorize it to 'Warehouse' (it was 'Labor'),
--    and rename it to 'Warehouse Assembly' to distinguish it from the on-site
--    'Assembly & Installation' (ASM_INSTALL, Delivery). The billing CODE stays
--    'ASM', so every billing/code-keyed path is unaffected.
UPDATE public.service_catalog
SET name          = 'Warehouse Assembly',
    category      = 'Warehouse',
    show_in_matrix = true
WHERE code = 'ASM';
