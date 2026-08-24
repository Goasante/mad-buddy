# Mad Buddy — Friend Beta issue log

The single authoritative record of what testers find. One row per distinct
problem, not per report: if three people hit the same thing, it stays one entry
and the reports accumulate under it.

**Opened:** 2026-08-24 · **Release:** `4cfd394` · **Live:** https://mad-buddy.com

---

## How to use this

**Do not fix everything as it arrives.** During early friend testing the job is
to *capture, reproduce, deduplicate, classify* — because five reports of the
same confusion tell you far more than five separate fixes would.

Fix immediately, without waiting for a batch:

- **P0** — anything security, data loss, or product-unusable
- payments behaving incorrectly
- signup / auth failures
- anything that stops testers from testing at all

Everything else gets logged and grouped. A P2 that four people hit is worth
more than three P3s nobody mentioned twice.

### Severity

| | |
| --- | --- |
| **P0** | security, data loss, or the product is unusable |
| **P1** | a major journey is blocked |
| **P2** | meaningful confusion or friction |
| **P3** | visual or minor polish |

### Category

`BROKEN` · `CONFUSING` · `FRICTION` · `VISUAL QUALITY` · `PERFORMANCE` ·
`PRIVACY/TRUST` · `PERSONAL PREFERENCE` · `FEATURE REQUEST`

**`PERSONAL PREFERENCE` is not a lesser category.** It is the honest label for
"I would have done this differently", and separating it from `CONFUSING` keeps
taste from being mistaken for a defect — and stops real confusion being waved
away as taste.

### Status

`NEW` → `REPRODUCED` → `TRIAGED` → `FIXING` → `FIXED` → `VERIFIED`
(or `CANNOT REPRODUCE` / `WONT FIX` / `DUPLICATE OF <id>`)

---

## Entry template

Copy this block for each new issue.

```
### BETA-000
- **DATE**
- **TESTER**
- **DEVICE**
- **OS**
- **BROWSER / APP MODE**
- **ROUTE**
- **CATEGORY**
- **SEVERITY**
- **REPRO STEPS**
  1.
  2.
- **EXPECTED**
- **ACTUAL**
- **SCREENSHOT/VIDEO REF**
- **STATUS** NEW
- **ROOT CAUSE**
- **FIX**
- **VERIFIED**
```

---

## Stabilization Batch 1 — in progress

Source: real tester reports and owner screenshots from the friend beta.

### BETA-001 — block → unblock → re-add leaves the conversation dead
- **SEVERITY** P1 · **CATEGORY** BROKEN · **ROUTE** `/messages/[id]`
- **STATUS** **PRODUCTION VERIFIED** (migration `20260824140000` applied 2026-08-24)
- **REPRO** Block a Muddy → unblock → add them again → open the thread → send.
  Banner reads "This conversation is closed." and the message shows
  Not sent / Retry / Delete. Permanent.
- **ROOT CAUSE** `blockUserAction` archives the pair's direct conversation via
  `applyBlockToConversations`. **Nothing ever un-archives it.**
  `unblockUserAction` only deletes the `blocked_users` row, and the
  relationship-lifecycle RPC that reactivates a friendship never touches
  `conversations`. `resolveSendPermission` refuses on
  `conversationStatus !== 'active'`, so the archive was a one-way door.
  The banner was a *correct* projection of a state that was never restored —
  hiding it would have hidden the bug, not fixed it.
- **FIX** `20260824140000_reopen_conversation_on_refriend.sql` — a trigger on
  `friendships` reopens an archived direct conversation when a friendship
  becomes live. Placed on the relationship, not on unblock: unblock alone must
  NOT reopen anything, because at that moment there is no relationship and
  reopening would restore a channel the other side never agreed to. In the
  database rather than application code because friendships are written from
  several RPCs and any future path would silently miss it.
- **SECURITY** A live block outranks the friendship — verified. Re-adding
  someone can never undo their block.
- **VERIFICATION** `scripts/hardening/block-unblock-readd.mjs` **13/13**,
  including the security edge and "an UPDATE that does not change `ended_at`
  reopens nothing". Failed 9/10 before the fix, at exactly the reported step.

### BETA-004 — profile editor overflows when the account has photos
- **SEVERITY** P1 · **CATEGORY** VISUAL QUALITY · **ROUTE** `/profile` (editor)
- **STATUS** **PRODUCTION VERIFIED**
- **REPRO** Open the profile editor on an account **with photos**. Content is
  clipped at the right edge: "Save profil…", "Lowercase letters, numbers, and
  undersco…", "Your full date and birth year stay priv…".
- **THE CLUE THAT CRACKED IT** The owner screenshot at "Photos 0 of 3" renders
  perfectly. Same screen, same phone — the only difference is photos.
- **ROOT CAUSE** `.profile-photos` is a **grid item**, and a grid item default
  `min-width: auto` resolves to its *content* intrinsic minimum rather than its
  container. The visibility chip row (Everyone / My Muddies / Only me) plus the
  reorder and remove buttons cannot shrink below ~385px, so the grid column
  computed to **384.6px inside a 316px box** and pushed the document to **422px**
  at a 390px viewport. Every `fixed inset-x-0` header and nav then stretched to
  match — which is why the whole page looked shifted rather than just this card,
  and why the first passes chasing the *widest* element found only symptoms.
- **FIX** `min-width: 0` on `.profile-photos`, `flex-wrap` + `min-width: 0` on
  the controls row, and `flex: 1 1 0` with ellipsis on the chips. Deliberately
  NOT `overflow-x: hidden` on an ancestor — that hides the clipping and leaves
  the controls genuinely unreachable off-screen.
- **INVARIANT** User-supplied images can never determine page width.
- **VERIFICATION** `scripts/hardening/profile-width-invariant.mjs` **30/30** —
  5 phone widths × 2 themes × (view + edit + Save-not-clipped), 3 photos loaded.

### BETA-002 — unread / notification lifecycle
- **SEVERITY** P1 · **CATEGORY** BROKEN · **ROUTE** nav badge, `/messages`, Plan Chat
- **STATUS** **INVESTIGATED — server side is CORRECT, cause is client-side**
- **REPRO (reported)** Group unread stays after viewing; Plan Chat unread stays;
  the nav badge does not decrease.
- **WHAT WAS TESTED** `scripts/hardening/unread-lifecycle.mjs`, **21/21**:
  direct, group and Plan Chat unread accrue and clear; reading one conversation
  clears only that one; my own messages never count against me; system messages
  never raise the badge; a removed member accrues nothing; the count survives
  reload; and — the decisive one — the **`conversation_previews` RPC that the
  badge actually calls** agrees with the read-cursor model at every step.
- **FINDING** The read cursor (`conversation_members.last_read_message_id`),
  `markConversationRead`, and the RPC are all correct and mutually consistent.
  Both the web action and the mobile API route call the same function.
  **The server-side lifecycle is not the defect.**
- **THEREFORE** The remaining candidates are client-side: badge state not
  refetched after `markConversationReadAction` resolves, a stale cached
  conversation list, or a Server-Component boundary not revalidating. That is
  where the next session should start — with a two-browser runtime
  reproduction, not another database audit.
- **NOT FIXED.** Recording a negative result rather than declaring victory: the
  harness passing 21/21 is evidence about the server, and the testers are
  describing something the server is not doing wrong.

### Remaining in this batch

Investigated and queued, not yet fixed:

| ID | Severity | Issue |
| --- | --- | --- |
| BETA-003 | P1 | Events surface renders blurred with no dialog |
| BETA-005 | P1 | Create Event modal overflows and jumps between audience options |
| BETA-006 | P1 | message edits do not reach the recipient |
| BETA-007 | P1 | Linkr mutual moment reaches only the second person; Say hi must open the chat |
| BETA-008 | P2 | Linkr "Hide from specific people" opens Safe Center |
| BETA-009 | P2 | @mentions do not render or resolve |
| BETA-010 | P2 | duplicate search inputs on Muddies and Messages |
| BETA-011 | P2 | private Muddy Circles to be removed (owner decision on MB-GOD-056) |
| BETA-012 | P2 | contact matching does not work on device |
| BETA-013 | P2 | Glow ring does not match avatar geometry |
| BETA-014 | P2 | scroll container extends into the bottom nav |
| BETA-015 | P2 | full-screen profile image viewer missing |
| BETA-016 | P2 | group/Circle interface shifts on touch |
| BETA-017 | P2 | Linkr preview card does not work |
| BETA-018 | P2 | Linkr mutual icon: heart → wave (owner decision) |

A note on the detector that found BETA-004: it initially reported **0 overflow
across 14 routes** — a false negative on two counts. It ran as an account with
no photos, and `/profile/edit` is a 404 (the editor opens in-page), so it was
scanning error pages and calling them clean. Both are fixed. The lesson is the
recurring one: **a probe that cannot reach the state cannot report on it.**

---

## Known and already carried

These are known before beta. **Log them again if a tester hits them** — real
evidence changes their priority, and a second opinion on how bad they feel is
exactly what beta is for. They do not block beta.

### BETA-KNOWN-1 — Profile media / post-save layout
- **CATEGORY** VISUAL QUALITY · **SEVERITY** P2 · **STATUS** OWNER-DEFERRED
- Known layout issue after saving profile media. Deliberately **not fixed**
  before beta and **not claimed fixed**. Carried since the God Mode program.
- Tester evidence welcome: how bad does it actually look on a real phone?

### BETA-KNOWN-2 — "Circles" names two different things (MB-GOD-056)
- **CATEGORY** CONFUSING · **SEVERITY** P3 · **STATUS** OWNER DECISION PENDING
- A "Circle" in Muddies is a private label on your own friends. A "Circle" in
  the launcher is a shared space other people are in. Same word, different
  objects, different privacy models.
- Recommendation prepared (`MB-GOD-056-circles-naming-recommendation.md`);
  the name is the owner's to choose. **Not part of this release.**
- Tester evidence especially useful: did anyone actually get confused, or is
  this only visible to someone who knows both surfaces?

### BETA-KNOWN-3 — `/hangout-mode` route name (MB-GOD-007)
- **CATEGORY** FRICTION · **SEVERITY** P3 · **STATUS** OWNER-BLOCKED
- The UpFor feature lives at `/hangout-mode`. Internal naming only; users
  rarely see it. Renaming is a migration with link-rot risk and is **not part
  of this release.**

### BETA-KNOWN-4 — Signature moments are quiet
- **CATEGORY** PERSONAL PREFERENCE · **SEVERITY** P3 · **STATUS** CARRIED
- Recorded during the God Mode program: the product's best moments do not
  announce themselves much. Genuinely a taste question, and beta is the right
  place to find out whether people notice.

---

## Payment testing during beta

**Mad Buddy Access is GHS 5.00/month, recurring until cancelled.**

Do **not** ask every tester to subscribe. Use a small number of designated
payment testers who have explicitly agreed, and tell them the amount and the
recurrence before they pay. Surprising a friend with a recurring charge is the
fastest way to lose both the tester and the friend.

Everyone else should test on **Welcome Access**, which needs no card:

- 14 days, starting when they add their first Muddy
- no payment method taken, nothing auto-renews
- when it ends, Linkr and UpFor lock; everything else stays free

Log payment issues as **P0** and fix immediately.

---

## What "free" must always mean

If a tester is ever asked to pay for any of these, it is a **P0** and the
release is at fault, not the tester:

Home · Muddies · Glow and proximity with Muddies · Profile · Messages and every
existing conversation · Plans and Plan chat · Events · Safe Arrival ·
notifications

Only **Linkr** and **UpFor** require Access, and only after Welcome Access ends.

Existing connections, conversations and Plans **survive expiry**. If a tester
loses access to a conversation or Plan they already had, that is a **P0**.
