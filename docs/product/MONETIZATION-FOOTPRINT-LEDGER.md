# Phase 1 — existing monetization footprint

What is already here, and what happens to each piece under the new model.
Written before any code was changed, so the plan is answerable against evidence.

---

## The headline finding

**The current model is inverted relative to the constitution.**

| | Constitution says | Repository does today |
| --- | --- | --- |
| Linkr | **PAID** | **completely ungated** — no billing reference anywhere in `lib/linkr/` |
| UpFor | **PAID** | **effectively ungated** — `max_active_hangouts: 3` / `max_hangout_capacity: 5` exist in the catalog but are enforced **nowhere** |
| Plans | **FREE** | capped at `max_active_plans: 5`, enforced in `lib/plans/service.ts` |
| Groups | **FREE** | capped at `max_private_groups: 3`, `max_group_members: 15` |
| Circles | **FREE** | capped at `max_personal_circles: 3` |
| Messages | **FREE** | `plan_chat_archive_days` differs by tier |
| Events | **FREE** | `max_event_circle_members`, `event_circle_archive_days` differ by tier |
| Muddies | **FREE** | `max_friend_requests_per_day` differs by tier (30 / higher) |
| Safe Arrival | **FREE** | **already neutral** — `UNLIMITED` on every tier |

So this is not "add a paywall to Linkr and UpFor". It is **move the boundary**:
take the tier caps off the free core, and put a single access boundary around
the two surfaces that currently have none.

A prior "Phase 0" pass already neutralized Safe Arrival, `max_muddies` and
`max_daily_moments` (`lib/billing/phase0-core-access.test.ts` locks those in).
That work is the precedent this phase follows and extends.

---

## Ledger

### Entitlement authority — REPLACE

| Location | Current purpose | Old-model dependency | Disposition |
| --- | --- | --- | --- |
| `lib/premium/access.ts` | `getCurrentSubscriptionAccess`, `requirePremiumPlan` | **plan ranking** `free < buddy_plus < buddy_pro` | **REPLACE** as product authority. This is the scattered-`isPremium` pattern the brief forbids repeating. |
| `lib/billing/entitlements.ts` | per-tier numeric/boolean caps | 21 numeric + 16 boolean keys keyed by tier | **REPLACE as authority**; the *catalog* stays for admin/history, but no product decision may read tier from it. |
| `lib/billing/effective-plans.ts` | resolves effective tier | tier | **MIGRATE** — becomes an input to the new resolver, not a decision. |
| `lib/billing/tier-overrides*.ts` | admin per-tier overrides | tier | **KEEP** for historical records; **REMOVE** from the product path. |
| `lib/billing/premium-identity.ts` | "Plus"/"Pro" badge identity | tier | **REMOVE** from product surfaces. One access boundary has no badge tiers. |

### Free-core caps — REMOVE from the product path

| Location | What it caps | Disposition |
| --- | --- | --- |
| `lib/plans/service.ts:311,410,458` | active plans, participants | **REMOVE cap** — Plans is free |
| `lib/messaging/rules.ts:316,559` | plan-chat archive | **REMOVE cap** — Messages is free |
| `lib/events/rules.ts:205,221` | event circle size/archive | **REMOVE cap** — Events is free |
| `lib/safety/safe-arrival.ts` | contacts, sessions | **KEEP** — already `UNLIMITED` on every tier |
| `lib/discovery/trust.ts:155-157` | friend requests/day | **KEEP the limit, DROP the tier axis** — this is anti-abuse, not monetization. One rate for everybody. |
| `lib/content/moments.ts` | Moments | **REVIEW** — Moments is not in the paid list; free. |
| `lib/meetups/service.ts:60` | `requirePremiumPlan(userId, "buddy_plus")` | **REPLACE** — the only hard tier gate in the product; re-point at the new resolver if the surface is UpFor-adjacent, else remove. |

**`max_friend_requests_per_day` deserves the note.** A per-day cap on friend
requests is spam control. Keeping it is right; keeping it *tiered* would mean
paying to send more friend requests, which is both a monetization of the free
core and an anti-abuse hole. It becomes one flat limit.

### Payment layer — KEEP

| Location | Why it survives |
| --- | --- |
| `app/api/paystack/webhook/route.ts` | HMAC-SHA512 + `timingSafeEqual` + length check, `provider_event_id` idempotency, `dedupe_key` ledger. Audited in Mission 6 and again here. Sound. |
| `app/api/paystack/initialize/route.ts` | Amount comes from `plan.amount` server-side; the client sends a plan identifier, never money. Already satisfies the price-authority rule. |
| `lib/paystack/config.ts` | Server-owned amounts (GHS 4.99 / 9.99 minor units). **The figures are the OLD tier prices** — the new single-product price is an owner decision. |
| `lib/paystack/sync.ts` | Rejects any transaction whose amount differs from config. Keep. |
| `subscriptions` table | Already has a `provider` column and Paystack + legacy Stripe fields. **Provider-neutral bones already exist.** |

### Admin — REUSE, do not invent

`lib/admin/governance.ts` already defines the permission catalogue and the
role→permission matrix, including:

```
admin.entitlements.view      admin.entitlements.manage
admin.billing.view           admin.billing.manage_plan
admin.billing.refund
```

Roles: `super_administrator`, `trust_safety_administrator`,
`customer_support_agent`, `billing_support_agent`, `verification_reviewer`,
`security_engineer`, `privacy_administrator`, `read_only_auditor`.

There is also a `STEP_UP_REQUIRED_ACTIONS` list. **No new permission needs
inventing** — grants map onto `admin.entitlements.manage`, and global override
onto `super_administrator` only.

### Jobs / notifications — MIGRATE

| Location | Disposition |
| --- | --- |
| `lib/jobs/handlers.ts:402` `handlePremiumTrialLifecycle` | **REPLACE** — the old trial lifecycle assumes a payment trial. Welcome Access is not one. |
| `premium_trials`, `premium_trial_events`, `premium_trial_notifications`, `premium_trial_config` | **KEEP as history**, stop being authority. Welcome Access gets its own table. |
| `earned_premium_rewards` | **KEEP**; becomes one more access source, not a tier. |
| `entitlement_overrides`, `tier_entitlement_overrides` | **KEEP for history**; not product authority. |

### Analytics / copy — CLEAN

| Location | Disposition |
| --- | --- |
| `lib/analytics/product-analytics.ts` `premium_feature_used_during_trial`, `premium_wallpaper_attempted` | **MIGRATE** to the new event names |
| `components/premium/*` (15 files: pricing page, plan comparison, upgrade page, plan badge…) | **REPLACE** the three-tier presentation with one access boundary |
| `lib/billing/upgrade-copy.ts` `HEADLINE_LIMITS` | **REWRITE** — headline limits are a tier concept |

---

## What this means for the build

1. **The resolver is new, not a rename.** The old authority ranks plans; the new
   one evaluates independent access *sources*. A rename would preserve the bug.
2. **The old tables stay for history.** Nothing is dropped. They stop being read
   on the product path, which is the part that matters.
3. **The payment layer is reused wholesale.** Its security properties are
   already audited; only the product it sells changes.
4. **Admin needs no new permissions.**
5. **The largest single job is removing caps from the free core**, not adding
   gates to Linkr/UpFor — because Linkr/UpFor have no gates at all today.

### Open owner decisions (architecture proceeds without them)

- **Final consumer price** for Mad Buddy Access. `lib/paystack/config.ts` holds
  old tier prices; a new single product needs a figure. Checkout completion is
  blocked on this; nothing else is.
- **Production launch timestamp** for the existing-user backfill, since the
  fair-introductory-period strategy needs a date that only the owner can set.
