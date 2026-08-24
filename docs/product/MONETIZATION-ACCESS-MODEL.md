# Mad Buddy Access — the monetization model

Authoritative. If this document and the code disagree, the code is the bug —
but the reasoning here is what the code is trying to express.

---

## The one sentence

> **Your existing social world is free. Expanding your social world is paid.**

Everything below follows from that. When a question comes up that this document
does not answer, ask which side of that line the thing falls on.

---

## Free forever

Not gated, not metered, not time-limited, on any tier, in any billing state:

| | |
| --- | --- |
| Home | Muddies and every existing connection |
| Glow and proximity with your Muddies | Profile |
| Messages, and every conversation you already have | Plans and Plan chat |
| Events | Safe Arrival |
| Notifications | Circles and Groups |

**Safety is never monetized.** The person who needs a third emergency contact is
the person in more danger. `max_safe_arrival_contacts` and
`max_active_safe_arrivals` are `UNLIMITED` on every tier and cannot be affected
by any payment state — asserted in `lib/access/free-core.test.ts`.

## Paid

Exactly two surfaces:

| Surface | What Access buys |
| --- | --- |
| **Linkr** | the candidate deck, Connect, discovery filters, starting a session |
| **UpFor** | creating an UpFor, the *stranger* half of the feed, joining a stranger's |

Nothing else in the product changes when somebody has Access.

---

## What expiry does, and does not do

> **Expiry stops the next expansion. It never destroys an existing commitment.**

| Survives expiry, always | Why |
| --- | --- |
| an existing mutual Linkr connection | you already matched; that is a relationship, not a feature |
| the conversation with that person | Messages is free forever |
| a Plan created from an UpFor | the commitment was already made |
| Plan chat and participants | same |
| seeing what your **own Muddies** are up for | your existing social world |
| leaving, ending, cancelling, blocking, reporting | nobody pays to get out |
| turning Linkr off | you can always stop being discoverable |

Nobody ever pays to keep talking to somebody they already connected with.

The two seams where the obvious gate would have been wrong, both in code today:

- **The UpFor feed has two branches.** `muddySessions` (existing Muddies, free)
  and `nearbySessions` (strangers, paid). The gate sits *between* them, not
  around the action.
- **Joining has two paths.** `viewableAsMuddy` short-circuits
  `viewableAsStranger`, so the gate lives inside the stranger branch only.

---

## Welcome Access

| | |
| --- | --- |
| Internal name | `WELCOME_ACCESS` |
| Duration | **14 days** |
| Starts at | **`first_muddy_added`** |
| Card required | **No** |
| Auto-renew | **No** |
| Payment method taken | **None** |

**It is not a payment trial** and must never be described as one internally or
to users. No payment instrument exists, nothing renews, and nothing can be
charged when it ends.

### Why it starts at the first Muddy

An auth row can exist before there is any product identity, and finishing
onboarding is still setup. `first_muddy_added` requires **another person to
agree**, so it is the first moment the product has demonstrably delivered
something. Waiting any later would make the clock depend on somebody else's
response.

### Why the trigger is in the database

`first_muddy_added` is recorded today by one application path, but friendships
are created inside RPCs. A future path that created one would silently fail to
start the clock. The trigger on `friendships` is the one place every friendship
passes through.

### Why it cannot be reset

A partial unique index allows exactly one `welcome_access` row per user:

```sql
create unique index access_grants_one_welcome_per_user
  on public.access_grants (user_id)
  where source = 'welcome_access';
```

Clearing cookies, reinstalling, signing out and switching device cannot delete a
row keyed on `user_id`. **No device fingerprinting is used or needed** — the
identity anchor is the account. The database refuses a second welcome grant even
to `service_role`; verified in `scripts/hardening/welcome-access-trigger.mjs`.

Reactivating an ended friendship does not restart it either: the friendships
upsert reuses the same row, and `on conflict do nothing` keeps the original
window.

### 14 days is a default, not a ceiling

Admin grants, subscriptions, global promotions and staff access may all exceed
it.

---

## Access sources, and how they combine

```
welcome_access   web_subscription   apple_subscription   google_subscription
admin_grant      staff              global_promo
```

**Access is the UNION of independently valid sources — not a precedence ladder.**

This is the single most important design decision in the model. Under a ladder,
revoking the top rung destroys access a lower rung legitimately granted: revoke
somebody's admin grant and their paid subscription stops working. Under a union,
each source stands on its own.

Verified in `scripts/hardening/access-resolver-matrix.mjs`:

- revoking a **welcome** grant leaves **paid** access intact
- revoking an **admin grant** leaves **paid** access intact
- ending a **global promotion** returns everybody to their own source

`primarySource` exists only to decide what to *display*. It never decides
whether access exists.

### Expiry is resolver-time

A grant whose `expires_at` has passed is simply not counted. **No background job
flips anybody from active to expired** — jobs exist for reminders and
reconciliation only. Expiry is evaluated against **server time**; a device clock,
timezone change, reinstall or logout cannot move it, because none of them can
write to these tables.

---

## Data model

| Table | Responsibility |
| --- | --- |
| `access_grants` | per-user grants: welcome, admin, staff, promos |
| `access_global_windows` | one row per "everybody has access" period |
| `access_reminder_log` | reminder dedupe |
| `access_launch` | at most one row: when monetization went live |
| `subscriptions` | *existing* — provider state, already provider-neutral |

**There is no `profiles.is_premium`, no `linkr_enabled`, no cached boolean
anywhere.** Current state is a question asked of these rows at server time.

`access_grants` is **append-mostly**. Revoking sets `revoked_at`; it never
deletes the row or rewrites `expires_at`, because "who granted this, when, and
why" is exactly what an audit asks. An extension is a new row, not an edit.

**Global promotions never touch user rows.** One row serves every user. Mass
updating would make ending a promotion destructive — it would have to guess what
each person held beforehand.

### RLS

A user may **read** their own access and may **never write it**. There is no
INSERT, UPDATE or DELETE policy on any access table: with RLS enabled and no
permissive policy, those commands are denied outright. Self-granting, extending
one's own expiry and un-revoking are impossible through the RLS client whatever
the application does.

`scripts/hardening/access-bypass-matrix.mjs` — **21/21 refused**, with a negative
control proving the harness detects a real hole. Includes self-inserting a Mad
Buddy Access subscription, self-upgrading to it, and extending a paid period.

---

## Existing users at launch

Both obvious readings are wrong:

- *"their window already elapsed"* — every existing user is expired the instant
  monetization ships, having never seen the model. Punitive.
- *"restart everyone"* — silently re-grants dormant accounts, repeatedly.

**The mechanism:** `access_launch` holds at most one row, set by the owner. Until
it exists, `launch_welcome_access_for_existing_users()` does nothing. When set,
every existing account with a Muddy gets a full 14-day window **dated from
launch** — the same 14 days everybody else gets, because the window exists so
somebody can try the features before deciding, and they have not had that chance
yet. Idempotent: rehearsed locally, 6 granted then 0 on a second run.

**The launch date is an owner decision and was not invented.**

---

## Reminders

Two, not four:

| When | Message |
| --- | --- |
| 4 days remaining | ends in 4 days; what stays free; nothing will be charged |
| 1 day remaining | ends tomorrow; existing connections and Plans are unaffected |

Days 12 and 14 were deliberately dropped. Day 12 adds nothing day 10 did not,
and a notification on the day access ends arrives too late to act on while still
nagging. What day 14 needs is a good locked state, which exists. Settings shows
the remaining days to anyone who looks — nobody has to be interrupted.

**Nobody is warned whose access is not actually ending.** A person holding a
subscription, an admin grant, or covered by a global promotion is skipped.

Idempotency is a unique constraint on `(grant_id, milestone)`, claimed *before*
sending — so the worst case is a missed reminder, never a duplicate.
`scripts/hardening/access-reminders.mjs` — 9/9, including three concurrent runs
producing exactly one notification.

---

## Product language

Use **Mad Buddy Access**. Never *Plus*, *Pro*, *Premium*, *Gold*, *VIP*, or
"upgrade your account" — there is one boundary, not a ladder, and the free part
of the account is not being upgraded away.

### No dark patterns

Prohibited, and asserted at runtime in `access-visual-matrix.mjs`:

fake countdowns · "N people are waiting" · fake scarcity · guilt copy · hidden
dismissal · misleading "free" wording · forcing a payment method · repeated
modal spam.

The locked state answers four questions in the order people ask them: what the
feature does, why it stopped, **what still works**, how to get it back. The
third is not padding — without it, "your access has ended" reads as "Mad Buddy
has ended".

---

## Admin

Reuses the existing capability system. Grants map to `admin.entitlements.manage`.

| Action | Permission |
| --- | --- |
| Grant up to 30 days | `admin.entitlements.manage` |
| Grant 3 months, 1 year, indefinite, or a custom expiry | `+ admin.access.global.manage` |
| Open or end a global promotion | `+ admin.access.global.manage` |

`admin.access.global.manage` is a **new, dedicated permission** held only by
`super_administrator`. The first implementation borrowed `admin.roles.manage`
and called it owner-only; that is false — `trust_safety_administrator` holds it,
so a T&S admin could have given the entire user base a paid product. Caught by
`lib/access/admin-privilege.test.ts` on its first run.

**Admins never fake payment records.** Nothing writes to `subscriptions`. A
grant is the honest record of what happened; a fake subscription would corrupt
revenue reporting and lie about provenance. Revocation is scoped to
`admin_grant` only — revoking "access" wholesale would cancel a paid
subscription from a support screen, a different decision with a refund attached.

Every action is audit-before-mutate: if the audit write fails, nothing changes.

---

## Payments

```
provider event → verified server processing → canonical subscription row
               → entitlement resolver → access
```

**The provider is never the authority.** The resolver reads the local
`subscriptions` row that verified webhook processing wrote — never Paystack's
API at request time. A forged callback cannot reach it, and a provider outage
cannot revoke a paying customer mid-request.

**Price is server-owned.** `accessCheckoutAmount()` takes no parameters, so
"client sets the price" cannot be written against it. The client sends a product
identifier; the amount comes from configuration. `lib/paystack/sync.ts` rejects
any transaction whose amount differs.

**The consumer price is set: GHS 5.00 / month, Paystack plan
`PLN_pbpn6h7vprirvlu`, monthly interval.**

Both live in `lib/access/product.ts` as defaults IN SOURCE, not as required
environment variables. An env-only price fails in the worst direction: a missing
or fat-fingered variable in one environment silently disables checkout, or
disagrees with what Paystack actually charges. `MAD_BUDDY_ACCESS_AMOUNT_MINOR`
and `MAD_BUDDY_ACCESS_PLAN_CODE` remain as overrides for test and staging.

The amount is **500** — minor units (pesewas), not 5 cedis. A value in cedis
would charge one hundredth of the price while every amount check still passed,
because both sides would agree on the wrong number.

### What the webhook verifies, and why each matters

Every field is compared against server configuration; nothing is trusted from
the payload.

| Check | Why |
| --- | --- |
| **plan code** — must equal `PLN_pbpn6h7vprirvlu`, and is REQUIRED | An amount alone is non-specific: GHS 5.00 is an unremarkable sum that could arrive from any transaction. The plan code ties a payment to *this* recurring product. |
| **amount** — exactly 500, when present | Stops a tampered checkout for GHS 0.01 activating access. Absent on lifecycle events like `subscription.disable`, which is why it is conditional. |
| **currency** — GHS | GHS 5.00 paid in another currency is a different, smaller payment. |
| **metadata product** — when present, must not contradict | Set at checkout so the webhook can confirm the product independently of the plan code. |

A single mismatch rejects the whole event. The route still returns 200 (so
Paystack stops retrying) but **writes nothing**.

### The subscription record

Access rows are written as `plan = "mad_buddy_access"`, never as a legacy tier.
A tier label would have "worked" — the resolver only asks whether a subscription
is live — while attributing this product's revenue to one nobody can buy and
breaking reconciliation against the Paystack plan code.

`SubscriptionPlan` (the retired ladder) and `SubscriptionProduct` (what a row
may hold) are separate types for this reason. Ladder-shaped consumers —
wallpaper tiers, tour gating, buddy-score rewards, MRR movement — call
`legacyTierOf()`, which maps Access to `"free"`. That is the honest answer:
Access grants nothing *through* the ladder.

### Cancellation keeps the paid period

`subscription.not_renew` sets `cancel_at_period_end` and status `non_renewing`.
It does **not** revoke access — the customer has paid for time they have not
used. The resolver counts `non_renewing` as live and lets `current_period_end`
end it.

This was a real bug, caught by `scripts/hardening/access-payment-matrix.mjs`:
the resolver's status filter omitted `non_renewing`, so cancelling instantly
revoked a paid period and punished people for cancelling early.

**Apple and Google are provider-ready only.** They exist as source types with no
integration behind them — no receipt verification is faked. Store policy will be
re-verified at native implementation time.

---

## Security invariants

1. A user can read their own access and can never write it.
2. Welcome Access starts once per account, enforced by the database.
3. Expiry uses server time only.
4. Entitlement is never cached past a mutation — the guard resolves against the
   database on every paid-surface check.
5. Every Linkr and UpFor decision derives from `lib/access/resolver`. No call
   site re-implements the decision or queries the access tables directly.
6. The provider is not the authority; the local subscription row is.
7. Admins cannot fabricate payment records.
8. Global access requires a permission only the owner holds.
9. Free-core entitlements are `UNLIMITED` on every tier.
10. No paid tier is ever worse than free.
