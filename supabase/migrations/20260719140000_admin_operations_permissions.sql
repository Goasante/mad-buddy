-- Admin operations permissions and support consolidation.
-- Additive and idempotent. No private location or message data is exposed.

-- Every recognised admin role may suspend and restore user access.
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.users.suspend'
from public.admin_roles
on conflict (role_id, permission_key) do nothing;

-- Owner receives the complete operational permission set.
insert into public.admin_role_permissions (role_id, permission_key)
select roles.id, permissions.permission_key
from public.admin_roles roles
cross join unnest(array[
  'admin.users.view_summary', 'admin.users.restrict', 'admin.users.suspend',
  'admin.users.restore', 'admin.sessions.revoke', 'admin.reports.review',
  'admin.appeals.review', 'admin.support.manage', 'admin.billing.view',
  'admin.billing.refund', 'admin.verification.review', 'admin.organisations.restrict',
  'admin.security.events.view', 'admin.security.incidents.manage',
  'admin.privacy.requests.manage', 'admin.audit.view', 'admin.feature_flags.manage',
  'admin.emergency_controls.manage', 'admin.roles.manage'
]) as permissions(permission_key)
where roles.name = 'super_administrator'
on conflict (role_id, permission_key) do nothing;

-- Owners and trust and safety admins may create non-owner staff accounts.
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.roles.manage'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator')
on conflict (role_id, permission_key) do nothing;

-- Owners, trust and safety admins, and support agents may work support queues.
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.support.manage'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator', 'customer_support_agent')
on conflict (role_id, permission_key) do nothing;

-- These roles may run the safe session reset quick fix.
insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.sessions.revoke'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator', 'customer_support_agent')
on conflict (role_id, permission_key) do nothing;

-- Promote the requested account when it exists in Supabase Auth.
insert into public.admin_users (email, auth_user_id, role, disabled_at)
select lower(email), id, 'owner', null
from auth.users
where lower(email) = 'godfredfosu004@gmail.com'
on conflict (email) do update set
  auth_user_id = excluded.auth_user_id,
  role = 'owner',
  disabled_at = null,
  updated_at = now();

update public.admin_assignments
set status = 'revoked', updated_at = now()
where user_id = (select id from auth.users where lower(email) = 'godfredfosu004@gmail.com' limit 1)
  and role_id <> (select id from public.admin_roles where name = 'super_administrator');

insert into public.admin_assignments (user_id, role_id, status, starts_at, expires_at)
select users.id, roles.id, 'active', now(), null
from auth.users users
cross join public.admin_roles roles
where lower(users.email) = 'godfredfosu004@gmail.com'
  and roles.name = 'super_administrator'
on conflict (user_id, role_id) do update set
  status = 'active',
  starts_at = now(),
  expires_at = null,
  updated_at = now();

-- Preserve legacy Help submissions while consolidating the admin queue.
alter table public.support_tickets
  add column if not exists legacy_support_request_id uuid unique
    references public.support_requests(id) on delete set null;

insert into public.support_tickets (
  user_id,
  category,
  subject,
  description,
  priority,
  status,
  created_at,
  updated_at,
  resolved_at,
  legacy_support_request_id
)
select
  request.user_id,
  'other',
  left('Help request from ' || request.full_name, 160),
  request.message,
  'normal',
  case request.status
    when 'open' then 'new'
    when 'in_progress' then 'open'
    when 'resolved' then 'resolved'
    else 'closed'
  end,
  request.created_at,
  request.updated_at,
  case when request.status in ('resolved', 'closed') then request.updated_at else null end,
  request.id
from public.support_requests request
where not exists (
  select 1 from public.support_tickets ticket
  where ticket.legacy_support_request_id = request.id
);
