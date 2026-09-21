# Ads-first monetization — Codex handoff

Branch: `feature/ads-first-monetization`

Pull this branch before editing. Do not start from `main` and do not create a second monetization architecture.

## What is already implemented

- Mad Buddy Access is the canonical ad-free entitlement.
- Linkr and UpFor routes are free.
- Linkr Server Actions no longer consult Access.
- Existing Admin Access grants automatically make a member ad-free for the grant period.
- Admin feature controls exist for `ads_enabled`, `ads_inline`, `ads_anchor`, `ads_interstitial`; all seed OFF.
- PWA AdSense config is fail-closed through `ADSENSE_CLIENT_ID` and `ADSENSE_HOME_INLINE_SLOT`.
- `/api/access/status` and `/api/ads/status` are server-authoritative and no-store.
- PWA provider refreshes Admin/Access ad state during long-running sessions.
- Google ad CSP is nonce-based and expanded only on the approved Home route.
- `/ads.txt` is generated only from validated configuration.
- Responsive `InlineAdSlot` is implemented.
- Initial PWA policy permits only one format/surface: inline on `/dashboard`.
- Anchor and interstitial controls exist but policy returns false for both until a later reviewed implementation.

## Local patch 1 — wire the Home placement

File:

`components/dashboard/dashboard-page.tsx`

Add:

```ts
import { InlineAdSlot } from "@/components/ads/inline-ad-slot";
```

Find the canonical Home Near render:

```tsx
{composition.showNearby ? (
  <NearbyHero
    ...
  />
) : null}
```

Immediately AFTER it, before Top Events, add:

```tsx
{composition.showNearby ? (
  <InlineAdSlot placement="home-after-near" />
) : null}
```

Do not put the ad inside `NearbyHero`, inside the horizontal Muddy rail, or near a clickable navigation/control. Do not render it during early activation when Home has intentionally hidden Near.

Do not add a fake `Advertisement` card or reserve a large blank box. `InlineAdSlot` owns unfilled/disabled behavior.

## Local patch 2 — remove remaining dead UpFor Access checks

File:

`app/(app)/hangout-actions.ts`

Remove only the retired monetization checks/import:

```ts
import { checkAccess } from "@/lib/access/guard";
```

and the old Access branches around:

- `startHangoutAction`
- stranger candidates in `getVisibleHangoutsAction`
- stranger branch in `requestHangoutAction`

After removal, free users must receive the SAME stranger candidates that pass the existing privacy/proximity filters, and may request to join when the existing server checks pass.

Do NOT remove or weaken:

- authentication
- `consumeRateLimit`
- block checks
- Ghost Mode / visibility checks
- `canViewHangout`
- `canStrangerDiscoverUpFor`
- `canStrangerJoinUpFor`
- location freshness/proximity checks
- audience checks
- capacity checks
- `MAX_ACTIVE_UPFORS`
- `MAX_UPFOR_CAPACITY`
- ownership/lifecycle checks

Update comments that still say UpFor expansion is paid.

## Local patch 3 — retire Smart Card entitlement plumbing

Files:

- `lib/smart-card/home-projection.ts`
- `lib/smart-card/home-context.ts`
- `lib/smart-card/providers.ts`
- related `lib/smart-card/*access*` tests

The server dashboard already forces the compatibility input to `{ canExpand: true }`, so free users are not currently suppressed. Finish the cleanup:

- stop calling `resolveAccessForUser` from Home Smart Card projection;
- remove `AccessForCard` / `canExpand` if it has no remaining consumer;
- remove the no-Access fallback branch in `upForFallbackProvider`;
- remove the Access condition in `eventLinkrReadyProvider`;
- update tests so Access expiry does not affect Linkr/UpFor Smart Card eligibility.

Do not change event check-in/consent, privacy, safety, ranking or Smart Card priority semantics.

## Local patch 4 — retire the compatibility guard if no callers remain

After the UpFor cleanup, search the repository for:

```text
checkAccess(
requireAccess(
AccessRequiredError
PaidSurface
@/lib/access/guard
```

If `hasEverHadWelcomeAccess` is the only useful function left, move that helper to an appropriately named Access-history module and delete the obsolete Linkr/UpFor guard types.

Do not delete `lib/access/resolver.ts`; it remains the single authority for ad-free Access.

## Validation

Run at minimum:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also run the local ads-first runtime harness when the local Supabase stack is available:

```bash
node scripts/hardening/access-enforcement.mjs
```

No production AdSense id is required for CI. Missing ids must continue to mean no ad.

Commit and push back to the SAME branch. Report the commit SHA and any failures; do not merge the PR.
