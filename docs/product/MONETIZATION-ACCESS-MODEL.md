# Mad Buddy Access — ads-first monetization

Authoritative product model for web/PWA and the later native clients.

## The one sentence

> **Mad Buddy is free to use with ads. Mad Buddy Access removes ads.**

Linkr and UpFor are part of the free product. Access must never be used to block
those features again.

## Free product

A person without Mad Buddy Access can use the same core Mad Buddy experience,
subject only to the ordinary safety, privacy, abuse-prevention and product
feature flags that apply to everyone.

This includes:

- Home and Glow
- Muddies
- Linkr
- UpFor
- Messages and conversations
- Plans and Plan Chat
- Events
- Safe Arrival
- Notifications
- Circles and Groups
- Profile and account settings

Payment must not bypass or weaken safety rules, proximity rules, blocking,
reporting, rate limits, age rules, consent or anti-abuse ceilings.

## What Mad Buddy Access buys

Mad Buddy Access is one entitlement, not a tier ladder.

While any valid Access source exists:

- no Mad Buddy-controlled banner/inline ad may be requested for that account;
- no Mad Buddy-controlled anchor ad may be requested for that account;
- no Mad Buddy-controlled interstitial may be prepared or shown for that
  account;
- the user's product capabilities otherwise remain the same as the free app.

`lib/access/resolver.ts` remains the one entitlement authority.
`lib/access/ad-entitlement.ts` projects that state into the advertising answer:

```text
access.hasAccess === true  -> adFree = true
access.hasAccess === false -> adFree = false
```

There is no `profiles.isPremium`, `profiles.adFree`, client-owned premium flag,
or second advertising subscription table.

## Access sources

The resolver treats currently-valid sources as a union:

```text
welcome_access
web_subscription
apple_subscription
google_subscription
admin_grant
staff
global_promo
```

If any source is valid, the account is ad-free. Revoking one source never
invalidates another source that is still valid.

Expiry is evaluated against server time.

## Welcome Access

Welcome Access is **14 days without ads**.

Starts at: **Account creation, or `first_muddy_added`, whichever happens first.**
The first valid trigger wins; the second does not restart or extend the window.
The signup-trigger change is **not retroactive** for accounts that already
existed before that behavior was introduced.

It is not a payment trial:

- no card is required;
- no payment method is taken;
- it does not auto-renew;
- nothing is charged when it ends.

When Welcome Access expires, Mad Buddy keeps working. The account simply becomes
eligible for advertising if the global advertising controls are enabled.

## Price and billing

The current consumer price is **GHS 4.99**.

`lib/access/product.ts` is the server-owned price authority:

- `499` pesewas;
- Card: recurring Paystack monthly plan;
- Ghana Mobile Money: one-time payment for 30 days;
- cancellation/non-renewal never removes already-paid time;
- `past_due` keeps Access only through the resolver's valid grace window.

Provider records are inputs to the canonical local subscription state; the
provider is not the entitlement authority at request time.

## Admin controls

### Per-user ad-free control

The existing Admin Access-grant system is the per-user control.

Example: granting a member 7 days of Admin Access makes that account ad-free for
7 days. It does not fabricate a payment record and does not alter any other
Access source.

### Global advertising controls

Advertising uses the existing feature-flag system and the
`admin.feature_flags.manage` permission.

Four independent controls exist:

| Key | Purpose | Initial state |
| --- | --- | --- |
| `ads_enabled` | master advertising kill switch | OFF |
| `ads_inline` | responsive in-page PWA units | OFF |
| `ads_anchor` | future anchor/banner format | OFF |
| `ads_interstitial` | future natural-break full-screen format | OFF |

A format may run only when both the master flag and that format's flag are on.

Turning advertising off globally does **not** grant Access. It is simply a
period in which nobody is shown ads.

Missing rows, query failures and missing provider configuration fail closed to
**no advertising**.

## PWA advertising

PWA is the first advertising client.

Google AdSense configuration is server-owned through:

```text
ADSENSE_CLIENT_ID
ADSENSE_HOME_INLINE_SLOT
```

Both values must pass validation before the app exposes them to the client or
widens CSP for Google's ad transport. Placeholder values are rejected.

`/ads.txt` is generated from the validated publisher id and returns 404 while
AdSense is not configured.

The initial production format is a **responsive inline display ad**. The first
approved placement is Home, immediately after the Near/Glow section.

The web provider must not load the AdSense site script merely because anchor or
interstitial flags are enabled. Initial rollout is inline-only; Google Auto ads
must remain disabled until Mad Buddy explicitly owns the relevant format policy.

## Route policy

One centralized policy decides whether a placement may request an ad.

Ads are blocked on sensitive flows including:

- login/signup/onboarding;
- Safe Arrival and emergency/safety workflows;
- Access/billing/checkout;
- Admin;
- camera/call/video-call surfaces;
- active private/group conversations.

The Messages list may be considered later, but an active conversation remains
clean.

A placement also receives no ad when:

- the master flag is off;
- its format flag is off;
- the account is ad-free;
- required provider configuration is absent.

## Interstitial rule

Interstitial support is intentionally not live in the initial PWA rollout.

When implemented it must use named natural-break triggers, not random timers or
navigation interception. It must never show at app launch, chat open, Safe
Arrival, onboarding, checkout, camera/call flows or immediately after ordinary
navigation.

The initial feature flag remains OFF.

## Consent and Google configuration

Google privacy/consent configuration is a launch requirement, not a reason to
fake a local consent state. The production AdSense account must have the
appropriate Google-certified consent/privacy setup configured before live ads
are enabled for affected regions.

Until that setup and real publisher/slot ids are verified, all ad feature flags
stay OFF.

## CSP and failure behavior

The normal application CSP remains unchanged when AdSense configuration is
missing or invalid. Valid configuration conditionally adds only the Google ad
transport origins required by the PWA provider.

An ad-provider failure must never break navigation or core product behavior.
Ad blockers, an unfilled unit, a blocked network request, or a provider script
failure result in no ad and no replacement paywall.

## Native clients

Android/iOS reuse the same Access/ad-free semantics and Admin controls.

Native implementation uses AdMob later; it must not invent another entitlement
model. `/api/access/status` exposes the minimal server-owned Access projection
for native clients.

## Non-negotiable product rules

1. Linkr and UpFor are not paid surfaces.
2. Mad Buddy Access means ad-free, not more product capability.
3. A paying/granted/Welcome Access account must never receive a Mad
   Buddy-controlled ad.
4. Admin can turn all ads off without modifying anyone's Access.
5. Missing configuration or uncertain entitlement means no ad.
6. Ads never cover navigation or safety controls and never masquerade as Mad
   Buddy content.
7. No app-open ads, forced video ads, rewarded ads, fake close buttons or ad
   walls before Linkr/UpFor.
8. Production ad ids are never replaced with placeholders in source.
