-- Add Received Without ID accessorial rate at $10 to Standard Rates
INSERT INTO public.rate_card_details (rate_card_id, service_type, rate, category, charge_unit)
VALUES ('de26abb9-b20f-48e3-91ed-9bff0089e498', 'received_without_id', 10.00, 'accessorial', 'per_item');