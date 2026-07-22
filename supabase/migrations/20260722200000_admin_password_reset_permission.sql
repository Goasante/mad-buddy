-- Permit only Owner, Admin, and Support to send a standard Supabase recovery
-- email to a user. The application action remains server-only, rate-limited,
-- and audit-first. Staff never receive or set the user's password.

insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.users.recovery_link'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator', 'customer_support_agent')
on conflict (role_id, permission_key) do nothing;
