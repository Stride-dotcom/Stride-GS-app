-- Reset legacy range data: set both min and max to the same midpoint value (or null for open-ended)
-- XS: was 0-5, set to null (no single size)
UPDATE public.classes SET min_cubic_feet = NULL, max_cubic_feet = NULL WHERE code = 'XS' AND min_cubic_feet = 0 AND max_cubic_feet = 5;
-- S: was 5-15, set to null
UPDATE public.classes SET min_cubic_feet = NULL, max_cubic_feet = NULL WHERE code = 'S' AND min_cubic_feet = 5 AND max_cubic_feet = 15;
-- M: was 15-40, set to null
UPDATE public.classes SET min_cubic_feet = NULL, max_cubic_feet = NULL WHERE code = 'M' AND min_cubic_feet = 15 AND max_cubic_feet = 40;
-- L: was 40-100, set to null
UPDATE public.classes SET min_cubic_feet = NULL, max_cubic_feet = NULL WHERE code = 'L' AND min_cubic_feet = 40 AND max_cubic_feet = 100;
-- XL: was 100+, set to null
UPDATE public.classes SET min_cubic_feet = NULL, max_cubic_feet = NULL WHERE code = 'XL' AND min_cubic_feet = 100 AND max_cubic_feet IS NULL;