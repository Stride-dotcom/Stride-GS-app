-- Delete all existing unstackable rates (user requested single flat rate)
DELETE FROM public.rate_card_details 
WHERE service_type = 'unstackable';

-- Insert new accessorial rates for the Standard Rates rate card
-- Unstackable at $25
INSERT INTO public.rate_card_details (rate_card_id, service_type, rate, category, charge_unit)
VALUES ('de26abb9-b20f-48e3-91ed-9bff0089e498', 'unstackable', 25.00, 'accessorial', 'per_item');

-- Crate Disposal at $100
INSERT INTO public.rate_card_details (rate_card_id, service_type, rate, category, charge_unit)
VALUES ('de26abb9-b20f-48e3-91ed-9bff0089e498', 'crate_disposal', 100.00, 'accessorial', 'per_item');

-- Overweight at $100
INSERT INTO public.rate_card_details (rate_card_id, service_type, rate, category, charge_unit)
VALUES ('de26abb9-b20f-48e3-91ed-9bff0089e498', 'overweight', 100.00, 'accessorial', 'per_item');

-- Minor Touch Up at $31.25
INSERT INTO public.rate_card_details (rate_card_id, service_type, rate, category, charge_unit)
VALUES ('de26abb9-b20f-48e3-91ed-9bff0089e498', 'minor_touchup', 31.25, 'accessorial', 'per_item');