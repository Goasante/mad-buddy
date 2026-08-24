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

#### Client half — REPRODUCED, cause narrowed, not yet fixed

`scripts/hardening/unread-client-sync.mjs` drives two real accounts through two
real browser sessions and compares the rendered badge against the server's own
answer at each step. **6/7**, and the single failure is the reported defect:

```
start                       server=0  badge=0   agree
A sends a message           server=1  badge=0   DIVERGE  <-- BETA-002
B opens the conversation    server=0  badge=0   agree
after route transition      server=0  badge=0   agree
after hard refresh          server=0  badge=0   agree
```

So the divergence begins **when the message arrives**, not when it is read. The
badge is stale from the moment it should have appeared; opening the thread then
"clears" a badge that was already showing the wrong number. Every path that
re-runs the count (navigation, refresh, focus) is correct.

**What is confirmed working**, so the next session need not re-check it:

- the read cursor, `markConversationRead`, and the `conversation_previews` RPC
  (21/21, server harness)
- `messages` IS in the `supabase_realtime` publication
- RLS permits a joined member to `SELECT` the message, so Realtime is entitled
  to deliver it — verified as an authenticated user
- the messages page DOES dispatch `MESSAGES_UPDATED_EVENT` after mark-read
- `useUnreadMessageCount` listens for that event, for focus, for
  visibilitychange, and for a Realtime `INSERT` on `messages`

#### ROOT CAUSE FOUND — Content Security Policy blocked the WebSocket

**STATUS: FIXED.** And it was not a channel-auth race at all.

Instrumenting the live socket showed something blunter than any of the
suspects: **`websockets opened: 0`**. No `phx_join`, no `phx_reply`, no
`CHANNEL_ERROR`, no retry. The subscription was never attempted, because the
browser refused the connection:

```
Connecting to 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=<redacted>'
violates the following Content Security Policy directive:
"connect-src 'self' data: http://127.0.0.1:54321 http://127.0.0.1:54321 ..."
```

Note the origin listed **twice**, and no `ws://` anywhere. `lib/security/csp.ts`
mapped the Supabase origin to a socket scheme with:

```ts
supabase.replace(/^https:/, "wss:")
```

which silently does **nothing** to an `http://` origin. So local development
emitted the http origin twice and never authorised `ws://`, and CSP killed
every Realtime subscription before the socket opened.

**Production was unaffected** — it is `https`, so the replace worked and
`wss://cabkhxxn….supabase.co` is present in the live header. That is the
nastiest property of this bug: it existed *only* in the environment where the
fix would be developed and tested, which is why every database test stayed
green and why three sessions of server-side auditing found nothing.

**FIX** A `realtimeOrigin()` helper mapping `https:→wss:` **and** `http:→ws:`,
leaving anything else untouched rather than guessing.

**VERIFICATION**
- `lib/security/csp.test.ts` — 24/24, with a **negative control**: reinstating
  the original `replace` fails exactly 3 assertions, including "the origin is
  duplicated instead of mapped to ws://".
- `scripts/hardening/unread-client-sync.mjs` — **7/7**, up from 6/7. The badge
  now shows `1` the moment the message arrives, with no navigation or refresh.
- Socket confirmed open at runtime: `ws://127.0.0.1:54321/realtime/v1/websocket`,
  zero console errors.

### BETA-006 — message edits do not reach the recipient
- **SEVERITY** P1 · **CATEGORY** BROKEN · **ROUTE** `/messages`
- **STATUS** **FIXED — SAME ROOT CAUSE AS BETA-002**
- The messages page already subscribed with `event: "*"` (INSERT, UPDATE and
  DELETE) and refetched through the server action on any change. That code was
  correct the whole time; CSP was blocking the socket it depended on, so edits
  could no more propagate than arrivals could.
- **No second mechanism was added, and no polling.** One CSP fix closed both.
- **VERIFICATION** `scripts/hardening/message-edit-sync.mjs` — **4/4** with B
  keeping the conversation OPEN while A edits: B sees the original, the database
  holds the edited value with `edited_at` set, **B sees the edit without
  reloading**, and a reload remains canonical. A test that reloaded between the
  edit and the assertion would have passed even with the socket dead, so it
  deliberately does not.

**Note on the probe.** The first version read the `/messages` link's
`textContent` and got `""`, which is indistinguishable from "no badge" — a
false failure waiting to happen. It now reads the badge `<span>` directly and
treats its absence as an explicit zero, because the badge only renders when the
count is above zero.

### BETA-009 — @mentions do not render the person
- **SEVERITY** P2 · **CATEGORY** BROKEN · **ROUTE** Plan Chat in `/messages`
- **STATUS** **FIXED** (local, runtime-proven)
- **ARCHITECTURE: STRUCTURED, and already complete.** `lib/messaging/mentions.ts`
  stores identity as a **user id, never matched text** — with trigger detection,
  candidate filtering, reconciliation against the typed text, and a renderer
  that highlights only the ids the server persisted. `message_mentions`
  (`message_id`, `mentioned_user_id`) has existed all along. Both the composer
  and the renderer were wired to it.
- **ROOT CAUSE** The **candidate list**, not the mention system. The composer
  defaults `mentionCandidates = []` and opens its picker only when that list is
  non-empty. The group page passed one; `/messages` passed nothing. So in Plan
  Chat the picker never opened, `@Ama` stayed plain text, and no identity was
  stored — exactly the reported symptom.
- **WHY PLAN CHAT SPECIFICALLY** Clicking a `group` row in the inbox routes to
  `/groups/{id}`, a different page that already had candidates. The surface that
  genuinely stays inside `/messages` and is multi-party is **Plan Chat** — and
  it had no picker at all. The page already derived `hasMultipleSpeakers` from
  `kind !== "direct"` for message attribution, for the same underlying reason.
- **FIX** `listMentionCandidates()` (server) + `getMentionCandidatesAction()`,
  fetched per conversation alongside the thread, passed to the composer with
  `isGroup={selected.kind !== "direct"}`.
- **SECURITY — the outsider guard is server-side**
  - the caller must pass `resolveConversationAccess`
  - `status = 'joined'` only: invited, removed, banned and departed members are
    not mentionable
  - the sender is excluded (mentioning yourself must not notify you)
  - **no query parameter and no name search**, so it cannot enumerate users
    outside the conversation; filtering happens client-side over a list the
    server already decided the caller may see
  - direct conversations return `[]`
- **VERIFICATION**
  - `scripts/hardening/group-mentions.mjs` — **9/9**, with a **negative
    control**: removing the `joined` filter leaks removed and invited members
    and fails exactly 2 assertions.
  - `scripts/hardening/mentions-runtime.mjs` — **3/3**: the Plan Chat opens from
    the inbox, the composer is present, and typing `@Kwa` offers the real member
    "Kwame Boateng".
  - Identity survives a rename: the stored id is unchanged after the mentioned
    user's display name changes.
- **MENTION NOTIFICATION** Existing behaviour, not expanded. `message_mentions`
  rows are written by the send path and consumed by the existing notification
  layer; this tranche added no new notification product.
- **AN OUTDATED INVARIANT, CORRECTED** `composer-layout.test.ts` asserted that
  the inbox never sets `isGroup` — true when `/messages` hosted only direct
  chats, false once Plan Chat lives there. It now asserts the real property:
  neither surface hard-codes the answer, and the inbox must derive it from
  `kind`. A literal `isGroup={true}` would put a mention picker in a two-person
  chat.

### Batch 3 reproduction — three of five do NOT reproduce

`scripts/hardening/batch3-repro.mjs` measures all five at 390x844 dark, with
the viewport asserted before any result counts. **14/17**, and the three
failures are all one defect.

| Issue | Reproduced? | Measurement |
| --- | --- | --- |
| BETA-003 Events blur | **NO** | backdrops always paired with a dialog; after close, open→close→reopen and browser-back: `backdrops=0`, `body pointer-events=auto` |
| BETA-005 Create Event overflow | **NO** | `doc=390 vw=390` on both open passes; no offending element |
| BETA-010 duplicate search | **NO** | Muddies: exactly 1 (`"Search Muddies"`); Messages: exactly 1 (`"Search messages"`) |
| BETA-014 nav overlap | **YES** | see below |
| BETA-016 touch instability | **NO** | pressing a card moved 0 of 27 sampled elements, during and after |

**This does not mean the testers were wrong.** It means the defects are not
reproducible in this configuration, and the likely differences are worth
naming: the screenshots came from a real iOS device where
`env(safe-area-inset-bottom)` is non-zero (it is 0 in headless Chromium, a
limit this program has recorded before), on a production build, possibly
mid-flight during a route transition. BETA-003 in particular reads like a
transient state during navigation, which a settled-DOM probe cannot see.

Recommended next step for these three: a short screen-recording from the
tester, or the device's own Safari inspector — not more headless probing.

## Beta Recovery Sprint — Phase A (shipped)

Owner instruction: real-device screenshots and video are authoritative. Where
headless could not reproduce an iPhone state, the evidence stands and the code
was read for the defect instead.

| Ref | Issue | Root cause | Status |
| --- | --- | --- | --- |
| A1 | Circle unread never cleared | the Circle page never called `markConversationRead` at all | **FIXED** |
| A2 | Circle @mention vanished after send | picker inserted the placeholder "A Muddy"; renderer searched for the real name | **FIXED** |
| A3 | Events stranded blur | tour scrim rendered without requiring a step; `index` clamped only at mount | **FIXED** |
| A4 | Create Event content slid sideways | modal body is a flex child with no `min-w-0` | **FIXED** |
| A5 | Circle chat ended halfway up the phone | fixed `65vh` card instead of a filling viewport | **FIXED** |
| A6 | "Visibility is paused" not actionable | already answered by the activation card; pinned with tests | **VERIFIED, no defect** |

### A1 — the Circle never marked itself read

Direct chats and Plan Chat both live inside `/messages`, which calls
`markConversationReadAction` when a thread is selected. A Circle opens at its
own route, and nothing on that path ever cleared the unread state — so the
messages were visibly read and the badge kept counting them. Not a projection
bug, not a stale client: the call did not exist.

Fixed through the SHARED authority rather than a Circle-specific path.
`markConversationRead` re-checks `resolveConversationAccess` and writes only
the reader's own `last_read_message_id`; the page then dispatches the same
`MESSAGES_UPDATED_EVENT` the inbox uses, so the nav badge and conversation list
reconcile without a hard refresh. Keyed on the newest message id, so a message
arriving while the Circle is open is marked too.

**Proven in a real browser: 3 unread → open the Circle → 0.** Visiting
`/messages` first does NOT clear it, so the check is measuring the open.

**Count semantics, now documented:** the Messages nav badge is the sum of
per-conversation unread for conversations the viewer is a joined member of; a
Circle row badge is that same count for one conversation; the notification bell
is a different system entirely (`notifications`, not messages) and is not
affected by reading a Circle.

### A2 — the mention that vanished on send

`message_mentions` stored the right id and notified the right person. What
broke was the highlight: `MessageText` locates a mention by searching the text
for "@" + the name the projection returns, and `loadGroupDetail` substitutes
the placeholder **"A Muddy"** for a member whose profile it could not fully
read. Picking that member inserted "@A Muddy", and the renderer — looking for
their real name — found nothing.

Fixed on both sides. The picker no longer offers a placeholder as a name, and
the renderer matches EITHER the display name or the username, since those are
the two things a picker can insert. Widening the match cannot over-claim: every
alias belongs to an id the server already stored as a mention on that message.
The placeholder is now a shared constant, not a literal at five call sites.

**17/17 against the real database, with a negative control** proving the old
behaviour loses the mention.

### A3 — a scrim that outlived its card

`TourRunner` clamped its step `index` only in the `useState` initialiser, which
runs once. If the step list shrank while the tour was running — which is what
navigating can do, since steps stop being eligible — `index` pointed past the
end, `step` became `undefined`, and the running branch rendered its full-screen
`z-[94]` scrim WITHOUT requiring a step. A blur over the page, an empty card,
no way out. That is the reported defect, and navigation is exactly its trigger.

The position is now derived during render, so it can never be out of range, and
the overlay refuses to paint when there is no step behind it.

**Invariant now enforced by harness:** for every full-screen dimming layer,
something interactive must be reachable above it — hit-tested with
`elementFromPoint`, not rectangles. The negative control confirms the probe
detects a genuinely orphaned scrim.

### A4 — the dialog that slid sideways

The Modal's scrolling body is a flex child with no `min-w-0`, so its min-width
defaulted to `auto`: the intrinsic content minimum rather than its container.
One unbreakable child made the scroller wider than the panel, and because the
panel is `overflow-hidden` the surplus did not scroll — it was clipped, so the
contents read as shifted while the dialog frame stayed still. That is why it
looked like a broken step transition rather than a width bug, and why it hit
some audience steps and not others. The header got the same guard.

**Verified at 360/390/430:** all five audiences, dialog x = 12 every time, zero
overflowing elements.

### A6 — already answered, on a different surface

When visibility is off, `visibility_off` is a proximity-unknown state, so the
nearby section stands down entirely and the activation card takes over with
"Turn on visibility" — a 176x48 button wired to the canonical resume, confirmed
in the browser taking a ghosted profile back to `visible`. That is deliberate:
one surface owns the instruction rather than two disagreeing. Pinned with tests
instead of adding a competing control.

### Still open — tester recheck

BETA-002, BETA-006 (CSP/realtime, fixed locally, production always correct),
and the Batch 3 set (BETA-003 as a separate report from A3, BETA-005, BETA-010,
BETA-016). BETA-014 remains retracted.

### BETA-014 — a Quick Action sits underneath the bottom navigation
- **SEVERITY** P2 · **ROUTE** every route with the quick-actions menu
- **STATUS** **NOT REPRODUCED — the previous session's finding was a false
  positive, and the retraction is mine.**

**What was reported last session:** at 390x844 scrolled fully to the bottom of
`/friends`, a quick-actions "Events" link measured at `y=799 h=44` while the
bottom nav started at `y=769` — apparently unreachable behind the nav, on three
routes.

**Why that was wrong.** `getBoundingClientRect()` reports a rectangle for a
child even when an ancestor clips it away. The COLLAPSED quick-actions list is
`max-height: 0; overflow: hidden`, and its items still measure as real boxes
that happen to fall inside the nav band. The probe read those rectangles and
concluded the controls were hidden behind the nav, when the menu was simply
shut.

**The measurement that settles it**, taken with `document.elementFromPoint` at
each item's centre:

```
collapsed   list max-height 0px, overflow hidden
            element at "Plans" centre = NAV.fixed  -> not the item
            visibility visible, opacity 1, but CLIPPED and unreachable

expanded    listBottom = 686   navTop = 769
            every item sits 83px clear of the nav
```

So the geometry was correct all along: `.quick-actions` reserves
`--mobile-nav-height + env(safe-area-inset-bottom) + gap`, the stack grows
upward from there, and when open nothing touches the nav band.

**The probe is fixed** rather than deleted: `batch3-repro.mjs` now hit-tests
every candidate with `elementFromPoint` before counting it, so a clipped
descendant can never again be reported as a hidden control. With that
correction the batch reads **17/17**.

**The lesson, which is the recurring one in this program:** *clipped is not
hidden, and a rectangle is not reachability.* Rect-only probes have now
produced three confident false positives across this beta — decorative blobs
"escaping" the viewport, a link's empty textContent read as a zero badge, and
this. Ask the document what is actually at the point.

### Batch 3 status after correction

| Issue | Headless result | Status |
| --- | --- | --- |
| BETA-003 Events blur | not reproduced | **TESTER REPRO REQUIRED** |
| BETA-005 Create Event overflow | not reproduced | **TESTER REPRO REQUIRED** |
| BETA-010 duplicate search | not reproduced (1 field each) | **TESTER RECHECK REQUIRED** |
| BETA-014 nav overlap | not reproduced (retracted) | **TESTER RECHECK REQUIRED** |
| BETA-016 touch instability | not reproduced | **TESTER REPRO REQUIRED** |

**None of these are closed.** Headless Chromium passing is not evidence that a
real iPhone behaves the same way, and this environment is known to differ in
ways that matter here: `env(safe-area-inset-bottom)` is **0** rather than 34,
transitions settle before a probe reads the DOM, and touch feedback is
synthesised. Every one of these reports came from a real device.

No product code was changed for Batch 3.

### Remaining in this batch

Investigated and queued, not yet fixed:

| ID | Severity | Issue |
| --- | --- | --- |
| BETA-003 | P1 | Events surface renders blurred with no dialog |
| BETA-005 | P1 | Create Event modal overflows and jumps between audience options |
| BETA-007 | P1 | Linkr mutual moment reaches only the second person; Say hi must open the chat |
| BETA-008 | P2 | Linkr "Hide from specific people" opens Safe Center |
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
