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

## Open issues

_None yet — beta opens with this log empty._

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
