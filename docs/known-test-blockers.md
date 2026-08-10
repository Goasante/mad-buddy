# Known failing tests — unfinished work owned elsewhere

**As of the "Restore build and type safety" repair.**

TypeScript, ESLint and the production build are green. Three tests fail. They
are recorded here rather than fixed, because each one asserts behaviour from a
feature that is still in progress, and making the code match the test would mean
finishing somebody else's design by inference.

All three pass on committed HEAD as it was before the in-flight work landed in
the tree, so they are caused by that work rather than by the repair.

---

## 1. `lib/groups/system-events.test.ts`

**"routes a group message to the group, not the DM inbox"**

The test expects a notification destination of the form
`group_message:${conversationId}`. Nothing emits that yet.

This is real product behaviour, not a cosmetic gap: without it, a message sent
in a group is announced as though it arrived in the direct inbox. Implementing
it means deciding how group notifications are grouped, deduplicated and
deep-linked — decisions the person building groups should make.

**Blocked on:** the group notification routing design.

---

## 2. `lib/social/radar-layout.test.ts`

**"adds faint specks rather than floating objects"**

Asserts a maximum opacity of `0.16`; the current value is `0.58`.

Somebody deliberately made the ambient layer more visible. Either the value is
the new intent and the test is stale, or the value is a mistake. Both are
plausible from the diff alone, and changing the wrong one silently alters a
visual decision.

**Blocked on:** confirmation of the intended ambient opacity.

---

## 3. `lib/design/glare-hover.test.ts`

**"adds one restrained glare layer to components/socialize/socialize-plan-card.tsx"**

The test expects exactly one glare layer on the Socialize plan card. There are
now zero — the layer was removed.

The removal looks intentional (the card was reworked), which would make the test
stale. But "the glare was deliberately dropped" and "the glare was lost in a
refactor" produce the same diff.

**Blocked on:** confirmation that the plan card is meant to have no glare layer.

---

## What was fixed in the repair

For contrast, the repair covered only unambiguous breakage — every failure with
exactly one correct resolution:

- `lib/profile/public.ts` — a duplicated block that declared `isSelf`,
  `isMuddy`, `relationship` and `plan` twice, and read `isSelf` inside the
  `Promise.all` that declared it.
- `lib/messaging/mobile.ts` — `verificationByUserId` referenced but never built;
  missing `otherIsVerifiedAccount` / `senderIsVerifiedAccount` type fields.
- `app/api/messages/unread-count/route.ts` — imported `getUnreadMessageCount`,
  which did not exist. Written against the same `conversation_previews` RPC the
  inbox uses, so the badge and the inbox cannot disagree.
- `components/plans/plans-page.tsx` — `status: string` where `PlanStatus` was
  required.
- Three type declarations and two test fixtures missing `isVerifiedAccount`.
- `VerifiedAccountMark` wired into the three identity surfaces its own tests
  already demanded.
