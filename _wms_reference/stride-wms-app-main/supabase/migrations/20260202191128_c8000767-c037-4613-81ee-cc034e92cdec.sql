-- Insert the admin-dev user profile with required password_hash placeholder
INSERT INTO public.users (id, email, password_hash, first_name, last_name, tenant_id, status)
VALUES (
  '042e3b86-e929-4577-966c-e8aa14011e41',
  'admin-dev@dev.local',
  'supabase_auth_managed',
  'Admin',
  'Dev',
  '00000000-0000-0000-0000-000000000001',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  status = EXCLUDED.status;

-- Assign the admin_dev role now that the user exists
INSERT INTO public.user_roles (user_id, role_id)
VALUES (
  '042e3b86-e929-4577-966c-e8aa14011e41',
  'a0000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;