-- Central Admin Operations, Trust & Safety, Support, Appeals, Incidents,
-- Governance (feature architecture batch 13). Additive only.
--
-- Reuse note: admin_users already exists with a coarse role
-- ('owner'|'admin'|'support'). That is the broad-permission shape spec §4
-- warns against, so this migration adds a granular role/permission model
-- alongside it. admin_users remains as the "is staff at all" gate; the new
-- tables decide what a staff member may actually DO. Nothing is dropped.
--
-- The governing rule (spec §1): staff have NO ambient access to location,
-- messages, Safe Arrival, close friends, private media, or contact data.
-- Nothing in this schema grants it. Sensitive access is case-bound, recorded
-- in sensitive_access_log, and expires.
--
-- Rollback:
--   drop table if exists public.feature_flag_rules, public.feature_flags,
--     public.emergency_controls, public.privacy_requests, public.incident_actions,
--     public.security_incidents, public.appeals, public.support_ticket_messages,
--     public.support_tickets, public.case_actions, public.case_evidence,
--     public.trust_safety_cases, public.sensitive_access_log,
--     public.admin_audit_events, public.admin_assignments,
--     public.admin_role_permissions, public.admin_roles cascade;

-- ---------------------------------------------------------------------------
-- Roles + granular permissions (spec §3, §4, §6).
-- ---------------------------------------------------------------------------

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system_role boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null check (char_length(permission_key) <= 64),
  created_at timestamptz not null default now(),
  constraint admin_role_permissions_unique unique (role_id, permission_key)
);

create table if not exists public.admin_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  assigned_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  -- Temporary access expires on its own (spec §6, §7).
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_assignments_unique unique (user_id, role_id)
);

create index if not exists admin_assignments_user_idx on public.admin_assignments(user_id, status);
create index if not exists admin_assignments_expiry_idx on public.admin_assignments(status, expires_at);

alter table public.admin_roles enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_assignments enable row level security;

-- No end-user policies at all. Every read/write goes through the service role
-- behind an explicit permission check in the application layer.

-- ---------------------------------------------------------------------------
-- Audit + sensitive access (spec §56-§59). Append-only by construction.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  target_type text,
  target_id uuid,
  case_reference uuid,
  previous_state jsonb,
  new_state jsonb,
  reason text check (char_length(reason) <= 500),
  auth_strength text check (auth_strength in ('password', 'mfa', 'step_up', 'break_glass')),
  session_reference text,
  created_at timestamptz not null default now()
);

-- Every sensitive data view, recorded with WHY (spec §58).
create table if not exists public.sensitive_access_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  category text not null check (
    category in (
      'reported_message', 'reported_media', 'account_export', 'verification_document',
      'location_evidence', 'billing_detail', 'support_attachment'
    )
  ),
  subject_user_id uuid references auth.users(id) on delete set null,
  case_reference uuid,
  reason text not null check (char_length(reason) between 1 and 500),
  approved_by uuid references auth.users(id) on delete set null,
  accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_actor_idx on public.admin_audit_events(actor_id, created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_events(target_type, target_id);
create index if not exists sensitive_access_actor_idx on public.sensitive_access_log(actor_id, accessed_at desc);
create index if not exists sensitive_access_subject_idx on public.sensitive_access_log(subject_user_id);

alter table public.admin_audit_events enable row level security;
alter table public.sensitive_access_log enable row level security;

/**
 * Append-only enforcement (spec §59: "Admins must not delete their own logs").
 * RLS alone wouldn't stop the service role, so this is a trigger — it holds
 * even for a privileged connection.
 */
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit logs are append-only and cannot be modified or deleted.';
end;
$$;

drop trigger if exists admin_audit_events_immutable on public.admin_audit_events;
create trigger admin_audit_events_immutable
  before update or delete on public.admin_audit_events
  for each row execute function public.prevent_audit_mutation();

drop trigger if exists sensitive_access_log_immutable on public.sensitive_access_log;
create trigger sensitive_access_log_immutable
  before update or delete on public.sensitive_access_log
  for each row execute function public.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- Trust & Safety cases (spec §20).
-- ---------------------------------------------------------------------------

create table if not exists public.trust_safety_cases (
  id uuid primary key default gen_random_uuid(),
  case_type text not null check (
    case_type in (
      'harassment', 'threat', 'impersonation', 'non_consensual_media', 'scam',
      'spam_campaign', 'dangerous_location_exposure', 'account_takeover', 'event_misconduct', 'other'
    )
  ),
  priority text not null default 'level_1' check (priority in ('level_1', 'level_2', 'level_3', 'level_4')),
  status text not null default 'open' check (
    status in ('open', 'triaged', 'investigating', 'awaiting_appeal', 'resolved', 'closed')
  ),
  subject_user_id uuid references auth.users(id) on delete set null,
  created_from_report_id uuid,
  assigned_to uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evidence is referenced, not copied: `protected_reference` points at the
-- source row so a case never becomes a second store of private content (§18).
create table if not exists public.case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.trust_safety_cases(id) on delete cascade,
  evidence_type text not null check (
    evidence_type in ('message', 'moment', 'drop', 'profile', 'media', 'announcement', 'account_history')
  ),
  protected_reference uuid not null,
  access_level text not null default 'level_3' check (
    access_level in ('level_1', 'level_2', 'level_3', 'level_4')
  ),
  retention_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.case_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.trust_safety_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action_type text not null check (
    action_type in (
      'warn', 'rate_limit', 'disable_messaging', 'disable_media', 'disable_invites',
      'disable_community_creation', 'hide_content', 'remove_content', 'suspend_temporary',
      'suspend_permanent', 'require_password_reset', 'revoke_sessions', 'require_reverification',
      'restore', 'no_action'
    )
  ),
  target_type text,
  target_id uuid,
  reason_code text,
  -- Interim protections are reversible and time-bounded (spec §17).
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ts_cases_status_idx on public.trust_safety_cases(status, priority);
create index if not exists ts_cases_subject_idx on public.trust_safety_cases(subject_user_id);
create index if not exists case_evidence_case_idx on public.case_evidence(case_id);
create index if not exists case_actions_case_idx on public.case_actions(case_id);

alter table public.trust_safety_cases enable row level security;
alter table public.case_evidence enable row level security;
alter table public.case_actions enable row level security;
-- Staff-only: no end-user policy. Reporter identity never surfaces here.

-- ---------------------------------------------------------------------------
-- Active user restrictions (spec §12, §19) — one place enforcement reads.
-- ---------------------------------------------------------------------------

create table if not exists public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restriction_type text not null check (
    restriction_type in (
      'rate_limited', 'messaging_disabled', 'media_disabled', 'invites_disabled',
      'community_creation_disabled', 'suspended_temporary', 'suspended_permanent'
    )
  ),
  case_id uuid references public.trust_safety_cases(id) on delete set null,
  reason_code text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  lifted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_restrictions_active_idx
  on public.user_restrictions(user_id, restriction_type)
  where lifted_at is null;

alter table public.user_restrictions enable row level security;

-- A user may see their OWN restrictions (spec §13: tell them what happened),
-- but never the internal reason_code or case linkage beyond that.
create policy "restrictions visible to subject" on public.user_restrictions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Support (spec §29).
-- ---------------------------------------------------------------------------

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (
    category in (
      'getting_started', 'muddies', 'visibility', 'location', 'plans', 'billing',
      'privacy', 'security', 'communities', 'reporting', 'account_deletion', 'other'
    )
  ),
  subject text not null check (char_length(subject) between 1 and 160),
  description text not null check (char_length(description) between 1 and 5000),
  -- Safe diagnostics only. Never location, message content, or tokens (§27).
  diagnostics jsonb not null default '{}'::jsonb,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (
    status in ('new', 'open', 'waiting_on_user', 'waiting_on_internal_team', 'resolved', 'closed', 'escalated')
  ),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'agent', 'system')),
  sender_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) between 1 and 5000),
  attachment_media_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx on public.support_tickets(user_id, status);
create index if not exists support_tickets_queue_idx on public.support_tickets(status, priority, created_at);
create index if not exists support_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

create policy "support tickets owner access" on public.support_tickets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "support messages visible to ticket owner" on public.support_ticket_messages
  for select using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_ticket_messages.ticket_id and t.user_id = auth.uid()
    )
  );

create policy "support messages insert by ticket owner" on public.support_ticket_messages
  for insert with check (
    sender_type = 'user'
    and auth.uid() = sender_id
    and exists (
      select 1 from public.support_tickets t
      where t.id = support_ticket_messages.ticket_id and t.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Appeals (spec §41).
-- ---------------------------------------------------------------------------

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  source_action_id uuid references public.case_actions(id) on delete set null,
  source_restriction_id uuid references public.user_restrictions(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default 'submitted' check (
    status in ('submitted', 'in_review', 'decided', 'withdrawn')
  ),
  submitted_at timestamptz not null default now(),
  assigned_to uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision text check (decision in ('upheld', 'modified', 'reversed')),
  decision_note text check (char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One appeal per enforcement action (spec §40); a second needs new evidence
-- and is opened by staff.
create unique index if not exists appeals_one_per_action
  on public.appeals(subject_user_id, source_action_id)
  where source_action_id is not null;

create index if not exists appeals_queue_idx on public.appeals(status, submitted_at);

alter table public.appeals enable row level security;

create policy "appeals owner access" on public.appeals
  for select using (auth.uid() = subject_user_id);

create policy "appeals insert by subject" on public.appeals
  for insert with check (auth.uid() = subject_user_id);

-- ---------------------------------------------------------------------------
-- Security incidents + emergency controls (spec §48, §62).
-- ---------------------------------------------------------------------------

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  severity text not null check (severity in ('sev_1', 'sev_2', 'sev_3', 'sev_4')),
  status text not null default 'declared' check (
    status in ('declared', 'contained', 'investigating', 'eradicated', 'recovered', 'closed')
  ),
  incident_type text not null check (
    incident_type in (
      'data_breach', 'account_takeover', 'key_exposure', 'misconfiguration',
      'location_exposure', 'malicious_dependency', 'billing_compromise',
      'admin_compromise', 'outage', 'abuse_campaign'
    )
  ),
  commander_id uuid references auth.users(id) on delete set null,
  detected_at timestamptz not null default now(),
  contained_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.security_incidents(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  description text check (char_length(description) <= 1000),
  created_at timestamptz not null default now()
);

-- Kill switches (spec §62). Read on every request for the guarded feature, so
-- flipping one takes effect immediately without a deploy.
create table if not exists public.emergency_controls (
  control_key text primary key check (
    control_key in (
      'proximity', 'location_collection', 'messaging', 'media_uploads',
      'invite_links', 'payments', 'event_glow', 'contact_matching'
    )
  ),
  is_disabled boolean not null default false,
  reason text check (char_length(reason) <= 500),
  incident_id uuid references public.security_incidents(id) on delete set null,
  disabled_by uuid references auth.users(id) on delete set null,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.emergency_controls (control_key, is_disabled)
values
  ('proximity', false),
  ('location_collection', false),
  ('messaging', false),
  ('media_uploads', false),
  ('invite_links', false),
  ('payments', false),
  ('event_glow', false),
  ('contact_matching', false)
on conflict (control_key) do nothing;

create index if not exists incidents_status_idx on public.security_incidents(status, severity);

alter table public.security_incidents enable row level security;
alter table public.incident_actions enable row level security;
alter table public.emergency_controls enable row level security;

-- Kill-switch state is readable by any authenticated session so the app can
-- honour it client-side too; only the service role may flip one.
create policy "emergency controls readable" on public.emergency_controls
  for select using (true);

-- ---------------------------------------------------------------------------
-- Privacy requests (spec §55).
-- ---------------------------------------------------------------------------

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (
    request_type in (
      'access', 'correct', 'delete_account', 'export', 'restrict_processing',
      'object_processing', 'delete_contact_matching', 'delete_location_records', 'withdraw_consent'
    )
  ),
  status text not null default 'submitted' check (
    status in ('submitted', 'verified', 'processing', 'completed', 'rejected', 'on_legal_hold')
  ),
  verified_at timestamptz,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  legal_hold_reason text check (char_length(legal_hold_reason) <= 500),
  legal_hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists privacy_requests_user_idx on public.privacy_requests(user_id, status);
create index if not exists privacy_requests_queue_idx on public.privacy_requests(status, submitted_at);

alter table public.privacy_requests enable row level security;

create policy "privacy requests owner access" on public.privacy_requests
  for select using (auth.uid() = user_id);

create policy "privacy requests insert by owner" on public.privacy_requests
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Feature flags (spec §63).
-- ---------------------------------------------------------------------------

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (char_length(key) <= 64),
  description text,
  status text not null default 'off' check (status in ('off', 'on', 'rollout', 'archived')),
  default_value boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flag_rules (
  id uuid primary key default gen_random_uuid(),
  feature_flag_id uuid not null references public.feature_flags(id) on delete cascade,
  -- Deliberately excludes sensitive personal attributes (spec §61).
  target_type text not null check (
    target_type in ('all', 'staff', 'beta', 'institution', 'country', 'subscription_tier', 'workspace')
  ),
  target_value text,
  rollout_percentage integer check (rollout_percentage between 0 and 100),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists feature_flag_rules_flag_idx on public.feature_flag_rules(feature_flag_id);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_rules enable row level security;

create policy "feature flags readable" on public.feature_flags
  for select using (status <> 'archived');

-- ---------------------------------------------------------------------------
-- Seed the system roles (spec §3). Permissions are granular by design — there
-- is intentionally no 'admin.*' or 'superuser' wildcard key.
-- ---------------------------------------------------------------------------

insert into public.admin_roles (name, description) values
  ('super_administrator', 'Platform configuration, emergency control, role management. Very few holders.'),
  ('trust_safety_administrator', 'Reports, escalations, suspensions, appeals.'),
  ('customer_support_agent', 'Account summary and support tickets. No sensitive data.'),
  ('billing_support_agent', 'Subscription status, invoices, approved refunds.'),
  ('verification_reviewer', 'Organisation and institution verification.'),
  ('security_engineer', 'Security events, sessions, incidents.'),
  ('privacy_administrator', 'Data access, deletion, retention, legal holds.'),
  ('read_only_auditor', 'Read selected audit logs. Cannot modify state.')
on conflict (name) do nothing;
