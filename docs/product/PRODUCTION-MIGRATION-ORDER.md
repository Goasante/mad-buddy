# Production application order — two migrations, owner-approved only

**NOTHING IN THIS DOCUMENT HAS BEEN APPLIED TO PRODUCTION.**
Both migrations were applied and verified against the local Docker Supabase
stack only (`http://127.0.0.1:54321`). No `db push` was run.

Apply in the order below. They are independent, but 090000 is the lower-risk of
the two and makes a good first check that the migration path works.

---

## 1. `20260824090000_first_reply_received_milestone.sql`

Adds a `first_reply_received` milestone so Home stops scanning message history
on every load (MB-GOD-060).

**What it does**

1. Widens `activation_milestones_milestone_check` — additive, every existing
   name preserved.
2. Backfills the milestone from data that already proves it.
3. Adds a trigger on `messages` to keep it true going forward.

**Backfill is REQUIRED, not optional.** `deriveHomeMaturity` checks
`looksEstablished` before the milestone check specifically so long-standing
accounts are not re-onboarded. Ship the code without the backfill and every
established user is demoted to `activating` on their next Home load.

**Ordering constraint:** the migration must land **before or with** the
application deploy. The new `loadMaturityEvidence` reads the milestone; if the
column value does not exist yet, established users briefly look new.

**Verification after applying**

```sql
-- Should return the same set both ways. Any row in the first result and not
-- the second is a user whose milestone is missing.
select count(*) from public.activation_milestones
 where milestone = 'first_reply_received';

select count(distinct cm.user_id)
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
 where cm.status = 'joined' and c.conversation_type = 'direct'
   and (select count(distinct m.sender_id) from public.messages m
         where m.conversation_id = cm.conversation_id
           and m.message_type <> 'system' and m.deleted_at is null
           and m.sender_id is not null) > 1;
```

Locally these matched exactly (4 = 4), and `scripts/hardening/first-reply-milestone.mjs`
passed 7/7 behavioural checks.

**Rollback:** documented in the migration footer. The application tolerates the
milestone being absent — `looksEstablished` falls back to plan participation —
so a rollback degrades rather than breaks.

---

## 2. `20260824100000_rls_recursion_repair.sql`

Breaks four RLS recursion cycles so RLS is protective rather than inert
(MB-GOD-058).

**Scope is larger than the ledger recorded.** The audit named seven tables in
one family. A live sweep of every RLS-protected table found **15 tables in four
families**; the three extra families would have stayed broken while the ledger
reported the issue closed.

| Family | Tables | In ledger? |
| --- | --- | --- |
| messaging | `conversation_members` + 5 joining through it | yes |
| safe arrival | `safe_arrival_sessions` ↔ `safe_arrival_contacts` | **no** |
| plans | `plans` ↔ `plan_participants` (+ 3 poll tables) | **no** |
| event circles | `event_circles` ↔ `event_circle_members` (+ announcements) | **no** |

**The grant that matters.** `anon` is granted EXECUTE on all four helpers, which
is deliberately *not* the `is_friend` precedent. `anon` holds SELECT on these
tables, so a signed-out client reaches these policies; without the grant the
policy cannot run its own helper and raises `permission denied for function ...`
— still closed, but it turns an empty list into a 500 and names an internal
function to an anonymous caller. The helpers read `auth.uid()` themselves and
take no user argument, so for `anon` they can only ever return false.

**Watch for the REVOKE hazard.** This codebase has been bitten before by
`REVOKE` stripping `service_role` and breaking the server. The migration writes
its grants explicitly and revokes only from `PUBLIC`. Verify after applying:

```sql
select proname, prosecdef, proconfig,
       array_to_string(proacl, ' ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('is_conversation_member','is_safe_arrival_traveller',
                   'is_plan_creator','is_event_circle_owner');
```

Every row must show `prosecdef = t`, `search_path=public, pg_temp`, and grants
to `anon`, `authenticated` **and `service_role`**.

Then confirm nothing recurses and the server still reads:

```sql
set role service_role;
select count(*) from public.conversations;   -- must return real rows
reset role;

set role anon;
select count(*) from public.conversations;   -- must return 0, with NO error
reset role;
```

**Verification evidence (local).**

- Live sweep: **131 tables readable, 0 recursing** (was 123 readable, 8 recursing).
- Behaviour matrix (`scripts/hardening/rls-recursion-matrix.mjs`), 7 personas ×
  9 tables: **0/63 correct → 63/63**, access granted **0/16 → 16/16**, and no
  persona gained access beyond what the policy specifies.
- Personas covered: joined member, removed member, outsider, traveller, contact,
  stranger, signed-out.

**Rollback:** documented in the migration footer. Rolling back restores the
recursion — i.e. restores deny-all on these tables. That is the pre-migration
state and is safe, because the application does not read them through the RLS
client. There is no window in which rolling back exposes more than rolling
forward.

**No application deploy is coupled to this migration.** Nothing in the app reads
these tables through the RLS client; the repair restores a defence-in-depth
layer beneath a boundary that already holds.
