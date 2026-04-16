-- Force PostgREST to reload schema cache so new/changed view columns are recognized immediately
NOTIFY pgrst, 'reload schema';