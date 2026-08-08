# Native subscriptions — decision memo (Task 8)

**Status:** awaiting a decision. No code has been written for this task.
**Author:** engineering, at the request of the pre-launch audit.
**Why this is a memo and not a patch:** the options differ in revenue, contractual
obligation and timeline, not in difficulty. That is a business decision.

---

## What exists today

`mobile/src/screens/SubscriptionScreen.tsx` renders the plan tiers and their
features, then ends with this:

> Manage or upgrade your subscription on the web at `<host>/upgrade`.

The host is rendered as **plain text inside a `<span>`** — not a link, not a
button, not tappable. A user who wants to pay has to read the address, leave the
app, and type it into a browser themselves.

So native billing today is not merely "informational". It is a dead end that
*looks* like a call to action.

Billing on web runs through **Paystack** (`lib/billing/`, `app/api/paystack/*`),
with entitlements resolved server-side from `subscriptions` into `buddy_plus` /
`buddy_pro`.

---

## The constraint that drives everything

Apple's App Store Review Guidelines require that digital content or services
consumed **inside** an app be sold through In-App Purchase, and prohibit
directing users to external purchase mechanisms to avoid commission. Google Play
has a comparable Payments policy, with a wider set of alternative-billing
programmes that vary by region.

Both positions have moved repeatedly (the US "link-out" entitlement, the EU
DMA, the Epic litigation, Google's User Choice Billing pilots). **The current
rules for your specific markets must be confirmed against the live guidelines
before committing** — this memo does not attempt to state them as settled fact.

> **STORE POLICY — MANUAL VERIFICATION REQUIRED**
> Confirm the present IAP obligation and any link-out entitlement for the
> countries you will ship in, on both stores, before choosing.

What is *not* in doubt: **shipping a payment path that the reviewer reads as
steering users out of the app to avoid commission is a rejection risk.** The
current screen arguably already does this, in the clumsiest possible way — it
names an external purchase URL without even making it usable.

---

## Option A — Implement In-App Purchase

Add StoreKit (iOS) and Google Play Billing (Android) via a Capacitor plugin.
Purchases happen natively; your server verifies the receipt and grants the same
`buddy_plus` / `buddy_pro` entitlement it grants today.

**For**
- The conventional path; lowest review risk.
- Best conversion. Purchase is 2 taps with a stored payment method.
- Restore-purchase and subscription management come from the platform.

**Against**
- Store commission (15–30% depending on tier and programme) on top of Paystack's
  existing fees for web.
- Two billing providers to reconcile. One user may hold a Paystack subscription
  and an IAP subscription; your entitlement resolver must pick a winner and never
  double-charge.
- Real work: receipt verification, the server-to-server notification endpoints,
  sandbox testing, and a restore flow. Not a weekend.
- **Paystack supports payment methods your market actually uses** (mobile money,
  local cards). IAP does not. For a Ghana-first product this is a genuine
  conversion loss, not a rounding error.

**Estimate:** 2–3 weeks including sandbox testing on both stores.

---

## Option B — Native is management-only; no purchasing

Native shows current plan and entitlements, and offers cancellation/management
of an existing subscription. It does not sell anything and does not point at a
purchase URL. Users who subscribe do so on the web, of their own accord.

**For**
- No commission. Paystack economics preserved.
- Small, honest change — mostly deleting the dead-end text and making current
  status accurate.
- Ships in days.

**Against**
- **A reviewer may still object** if the app reads as deliberately withholding
  purchasing to avoid commission. "Reader app" style allowances are narrow and
  probably do not fit a social product.
- Users who want to upgrade from their phone have a worse experience.
- Requires care in copy: no "subscribe on our website", no URL, no nudge. That
  restriction is itself the risk — the line between "we don't sell here" and
  "we're steering you elsewhere" is drawn by a reviewer, not by you.

**Estimate:** 2–3 days.

---

## Option C — Free tier only on native, at launch

Native ships with no subscription surface at all. Premium remains a web feature
until IAP is implemented properly.

**For**
- Removes the entire category of risk from the first submission.
- Gets the app into review sooner, which matters if the launch date is fixed.
- Buys time to do Option A properly rather than under deadline pressure.

**Against**
- Premium users cannot see their own status in the app they use daily. That is
  a bad experience for the people paying you.
- Entitlement-gated features must degrade gracefully rather than showing a lock
  with no explanation — otherwise you have built a different dead end.
- Defers the decision rather than making it.

**Estimate:** 1–2 days, plus a graceful-degradation pass on gated features.

---

## Recommendation

**Option C for the first submission, Option A immediately after.**

The reasoning is about sequencing, not economics. Option B's core weakness is
that its safety depends on how a reviewer interprets your copy, and you would be
discovering that interpretation *during* review, on the critical path to launch.
Option C removes the question entirely from a submission that already has other
firsts to get through.

Option A is where this should land — it is what users expect and it is
commission you can price for. It should not be built against a submission
deadline, because sandbox testing on two stores is exactly the kind of work that
overruns.

If the launch date is not fixed, **go straight to Option A** and skip the
intermediate step.

**What I would not do:** ship the current screen. It names an external purchase
URL, is unusable as a link, and combines the review risk of steering with none
of the conversion benefit.

---

## Whichever option is chosen

1. `SubscriptionScreen.tsx` must stop rendering a bare external URL as body text.
2. Entitlement resolution stays **server-side**. The client must never decide
   what a user has paid for, whatever the provider.
3. If two providers can ever coexist, define the precedence rule *before*
   writing code, and write a test for the double-subscription case.
4. Store listings must accurately describe what is purchasable in-app.

## Open questions for the decision-maker

- Is the launch date fixed?
- Which countries at launch? (Determines which alternative-billing programmes
  are even available.)
- What share of revenue is expected from mobile vs web?
- Is losing mobile-money payment on native acceptable in exchange for IAP
  conversion?
