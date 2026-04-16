-- Add billing_service_code to task_types for configurable task → service mapping
ALTER TABLE public.task_types 
ADD COLUMN IF NOT EXISTS billing_service_code TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.task_types.billing_service_code IS 'Service code from service_events table to use for billing when this task type completes';

-- Set default service codes for existing system task types based on current hardcoded mappings
UPDATE public.task_types SET billing_service_code = 'INSP' WHERE name = 'Inspection' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = 'Will_Call' WHERE name = 'Will Call' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = 'Disposal' WHERE name = 'Disposal' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = '15MA' WHERE name = 'Assembly' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = '1HRO' WHERE name = 'Repair' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = 'RCVG' WHERE name = 'Receiving' AND billing_service_code IS NULL;
UPDATE public.task_types SET billing_service_code = 'Returns' WHERE name = 'Returns' AND billing_service_code IS NULL;