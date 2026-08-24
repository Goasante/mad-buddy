# Production application order — five migrations, owner-approved only

**NOTHING IN THIS DOCUMENT HAS BEEN APPLIED TO PRODUCTION.**
All four migrations were applied and verified against the local Docker Supabase
stack only (`http://127.0.0.1:54321`). No `db push` was run.

Apply in the order below. 090000 and 100000 are independent of each other;
110000 and 120000 build the Mad Buddy Access model and must go in that order.

| # | Migration | What it does | Coupled to a deploy? |
| --- | --- | --- | --- |
| 1 | `20260824090000_first_reply_received_milestone` | stops Home scanning message history | **yes** — before/with the app deploy |
| 2 | `20260824100000_rls_recursion_repair` | makes RLS protective instead of inert | no |
| 3 | `20260824110000_access_entitlement_model` | access grants, global windows, Welcome Access trigger | **yes** — the app reads these tables |
| 4 | `20260824120000_access_reminders_and_launch` | reminder dedupe, launch mechanism | no |
| 5 | `20260824130000_access_subscription_plan` | adds `mad_buddy_access` to the `subscription_plan` enum | **yes** — before the deploy that writes it |

**Applying 3 does NOT start charging anybody.** It creates the tables and the
Welcome Access trigger. Nothing is gated until the application deploy that
contains the resolver and the two gates, and nothing can be purchased until a
price is configured (see below).

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


---

## 3. `20260824110000_access_entitlement_model.sql`

Creates the Mad Buddy Access entitlement model: `access_grants`,
`access_global_windows`, the `access_source` enum, the Welcome Access trigger on
`friendships`, and RLS on both tables.

**Coupled to the application deploy.** The resolver and both gates read these
tables. Apply the migration first; the app tolerates the tables being empty
(no rows = no access from grants), but not their being absent.

**Applying this does not gate anything on its own.** Linkr and UpFor stay open
until the deploy that contains `lib/access/guard`, and nothing can be purchased
until a price is configured.

**The Welcome Access trigger starts firing immediately.** From the moment this
lands, every new friendship creates a 14-day welcome window for both people.
That is correct and harmless before the gates ship — they simply have access
they would have had anyway.

**Verification after applying**

```sql
-- The once-only guarantee. This index is the entire anti-abuse story.
select indexdef from pg_indexes
 where schemaname='public' and indexname='access_grants_one_welcome_per_user';

-- RLS on, and NO write policy on either table.
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename in ('access_grants','access_global_windows');
-- Expect: exactly two rows, both SELECT. Any INSERT/UPDATE/DELETE row is a bug.

-- The trigger exists.
select tgname from pg_trigger where tgrelid='public.friendships'::regclass
   and tgname='friendships_start_welcome_access';
```

Then confirm a user cannot write their own access:

```sql
set role authenticated;
select set_config('request.jwt.claims','{"sub":"<any-real-user-id>","role":"authenticated"}',true);
insert into public.access_grants (user_id, source, expires_at, reason)
  values ('<same-user-id>','admin_grant', now() + interval '1 year','self grant');
-- Expect: new row violates row-level security policy
reset role;
```

**Verification evidence (local).**

- Welcome trigger: **9/9** — starts at the first Muddy for both people, exactly
  14 days, survives a second Muddy, survives end-and-remake, and the database
  refuses a second welcome grant even to `service_role`.
- Resolver matrix: **26/26** — every persona, source independence, the full
  global-promotion fallback, and the expiry boundary to the second.
- Bypass matrix: **18/18 refused**, with a negative control.

**Rollback:** in the migration footer. It drops all access records, and the
resolver treats "no sources" as no access — so a rollback **locks Linkr and
UpFor** rather than opening them. It fails closed. Restore from backup if
grants must survive.

---

## 4. `20260824120000_access_reminders_and_launch.sql`

Creates `access_reminder_log` (reminder dedupe) and `access_launch` plus
`launch_welcome_access_for_existing_users()`.

**Inert on application.** The backfill function returns 0 until a row exists in
`access_launch`, and that row is an owner decision. Applying this migration
changes nothing about anybody's access.

### The existing-user launch — OWNER ACTION, NOT PART OF THIS MIGRATION

When monetization goes live, and only then:

```sql
-- 1. Record the launch. Exactly one row is possible, ever.
insert into public.access_launch (launched_at, welcome_days, note)
values (now(), 14, 'Mad Buddy Access launch');

-- 2. Grant existing accounts their window. Idempotent -- safe to re-run.
select public.launch_welcome_access_for_existing_users();
-- Returns the number of accounts granted. A second call returns 0.
```

Every existing account **with a Muddy** gets a full 14-day window dated from
launch. Accounts without a Muddy get nothing now and start naturally when they
make one, exactly like a new signup. Anybody who already has a welcome grant
keeps theirs untouched.

Rehearsed locally inside a transaction: 6 eligible accounts granted on the first
call, **0 on the second**, then rolled back. No launch date was written.

**Verification after applying**

```sql
-- Must return 0 before the owner sets a launch.
select public.launch_welcome_access_for_existing_users();

-- The dedupe constraint that makes reminders safe under retries.
select conname from pg_constraint
 where conrelid='public.access_reminder_log'::regclass
   and conname='access_reminder_log_once';
```

**Rollback:** in the migration footer. Dropping `access_reminder_log` loses the
dedupe history, so already-sent reminders could send once more — harmless, but
worth knowing.

---

## Payment configuration — separate from every migration above

Checkout is blocked until both are set, and no migration sets them:

```
MAD_BUDDY_ACCESS_AMOUNT_MINOR   the price in minor units (pesewas for GHS)
MAD_BUDDY_ACCESS_PLAN_CODE      the Paystack plan code for the product
```

**The consumer price is an owner decision and was not invented.** The old
GHS 4.99 / 9.99 figures priced a three-tier ladder that no longer exists.
Until both variables exist, `isCheckoutConfigured()` is false and checkout
refuses rather than guessing — everything else in the entitlement system works.


---

## 5. `20260824130000_access_subscription_plan.sql`

Adds `mad_buddy_access` to the `subscription_plan` enum so Access subscriptions
are recorded as themselves.

**Additive only.** `alter type ... add value if not exists`. Every existing
value is untouched, so historical rows keep their meaning and no existing query
changes behaviour.

**Apply BEFORE the deploy that writes Access subscriptions.** The webhook writes
`plan = 'mad_buddy_access'`; without the enum value that insert fails and a
verified payment would not activate access.

**Why not reuse `buddy_plus`.** The resolver only asks whether a subscription is
live, so a tier label would have worked — and every revenue report, cohort
analysis and support conversation would attribute Access income to a tier nobody
can buy, while reconciliation against Paystack's `PLN_pbpn6h7vprirvlu` found no
correspondence at all. A payments ledger that misnames the product is worse than
one that fails loudly.

**Verification after applying**

```sql
select unnest(enum_range(null::subscription_plan));
-- Expect: free, buddy_plus, buddy_pro, mad_buddy_access
```

**Rollback:** Postgres cannot drop an enum value. Leaving it in place is
harmless — nothing reads it unless rows use it. To unwind Access
subscriptions, update the ROWS instead:

```sql
update public.subscriptions set status = 'cancelled' where plan = 'mad_buddy_access';
```

---

## Payment configuration — RESOLVED

The owner has created the Paystack plan. The price and plan code now live in
`lib/access/product.ts` as source defaults:

```
Mad Buddy Access    GHS 5.00 / month    PLN_pbpn6h7vprirvlu
amountMinor = 500   (pesewas, not cedis)
```

The environment variables remain as OVERRIDES for test and staging only:

```
MAD_BUDDY_ACCESS_AMOUNT_MINOR   optional -- overrides the price
MAD_BUDDY_ACCESS_PLAN_CODE      optional -- overrides the plan code
```

**Production still needs the real Paystack credentials**, which are not in this
repository and never should be:

```
PAYSTACK_SECRET_KEY
PAYSTACK_WEBHOOK_SECRET
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
```

The webhook route returns 503 unless ALL of these are present — a correct gate
that caught a missing public key during local testing.

**Register the webhook URL in the Paystack dashboard** to
`https://<your-domain>/api/paystack/webhook` for these events:

```
charge.success            subscription.create      subscription.enable
invoice.update            subscription.not_renew   subscription.disable
invoice.payment_failed
```
