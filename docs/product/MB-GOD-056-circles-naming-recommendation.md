# MB-GOD-056 — "Circles" names two different things

**Status: RECOMMENDATION ONLY. Nothing renamed. The name is the owner's to choose.**

This document exists so the decision is cheap to make, not to make it. Per the
brief: *do not choose a new name autonomously.*

---

## The collision, restated in one line

One word covers **a private label you put on your own Muddies** and **a shared
space other people are members of**.

| | Muddies → "Circles" | `/groups` → "Circles" |
| --- | --- | --- |
| Storage | `friend_circles` + `circle_members` | `conversations` + `group_settings` |
| What it is | a private audience label | a shared multi-person space |
| Who knows it exists | **only you** | **every member** |
| Purpose | audience filtering (`selected_circles` for Glow visibility, messaging permission, UpFor audience) | conversation + shared plans |
| Managed from | a Muddy's card menu | `/groups` |
| Route | `/friends?tab=circles` | `/groups` |

A user who makes a "Circle" in Muddies, then opens "Circles" in the launcher,
finds none of them. They are different objects with different privacy models —
which is the part that actually matters: one is **secret**, one is **shared**.

**Severity is P3 and no higher.** The two are separate tables with separate
services, and Mission 4 Extreme confirmed no shadow state. Nothing can be acted
on in the wrong place. This costs comprehension, not correctness.

---

## Measured rename cost

Counted rather than estimated, because the audit's original note assumed the
Muddies side was the smaller change and **that is backwards**.

| Surface | Option A (rename Muddies side) | Option B (rename `/groups` side) |
| --- | --- | --- |
| User-visible strings | **66** | **32** |
| Route/URL change needed | none (`/friends?tab=circles` — a query value) | **none** — the route is *already* `/groups` |
| Persisted user content | `friend_circles.name` — user-authored | group names — user-authored |
| Notification copy | 1 | 1 |
| Tour targets | 9 (shared between both) | 9 (shared between both) |
| Tests asserting the word | 33 files (shared) | 33 files (shared) |
| Enum / API values | **`selected_circles`** — appears in Glow visibility, messaging permissions, UpFor audience, onboarding privacy setup | none |

### The two facts that should drive the decision

**1. `/groups` is already called "groups" everywhere except its label.**
The route is `/groups`, the actions file is `group-actions.ts`, the table is
`group_settings`, the library is `lib/groups`. Only the *display string* says
"Circles". Renaming the label to "Groups" makes the product **more** internally
consistent, and touches no route, no table, and no enum.

**2. Option A drags an enum value with it.**
`selected_circles` is a stored audience value read by Glow visibility, messaging
permissions, UpFor audience and onboarding. Renaming the Muddies concept either
leaves that enum lying about itself, or turns a copy change into a data
migration. Option B has no equivalent.

So the audit's "smaller change" note was wrong: **Option B is the cheaper and
safer rename**, by both string count and by blast radius.

---

## Option A — rename the Muddies-side concept

Keep `/groups` as "Circles"; the private label becomes something else.

- **Cost:** 66 strings, plus the `selected_circles` enum problem above.
- **Argument for:** "Circle" has a warm social connotation that suits a shared
  space; the private label is the more mechanical of the two concepts and can
  take a more mechanical name.
- **Argument against:** the enum. And it renames the concept that has the
  *stronger* claim on the word — a circle of friends is, in ordinary English,
  your own private sense of who is close to you.

## Option B — rename the `/groups`-side concept *(the cheaper one)*

Keep "Circles" for the private Muddies label; the shared space becomes something
else.

- **Cost:** 32 strings. No route change, no table change, no enum change.
- **Argument for:** aligns the display name with the route, the table, the
  service and the actions file, all of which already say "group". Leaves
  `selected_circles` honest. Preserves the ordinary-English meaning of "circle"
  as *your own* circle of friends — which matches the private, only-you-know-it
  privacy model exactly.
- **Argument against:** "Groups" is generic, and every messaging product has
  them. It spends a distinctive brand word to gain clarity.

---

## Alternative names, for whichever side is renamed

Five, with an honest note on each. None is chosen here.

### If renaming the shared space (Option B)

| Name | Note |
| --- | --- |
| **Groups** | Already what the route, table and service call it. Zero surprise, zero learning cost, no brand value. The safe answer. |
| **Rooms** | Suggests a place you enter and leave, which matches a conversation space with membership. Slightly chat-app generic. |
| **Crews** | Warm, informal, fits the product's voice. Reads as more committed/permanent than some groups actually are. |
| **Tables** | Distinctive and social (a table you pull up a chair to), pairs well with plans and meeting up. Unfamiliar as a UI noun; needs teaching. |
| **Spaces** | Accurate and neutral. Currently fashionable, so it dates; also overlaps with other products' meanings. |

### If renaming the private label (Option A)

| Name | Note |
| --- | --- |
| **Lists** | Exactly what it is. Plain, instantly understood, no warmth. |
| **Groups of Muddies** | Unambiguous but long, and collides with "Groups" if Option B is ever taken. |
| **Tags** | Precise for a private label you attach to people. Reads technical, and "tagging" people has other connotations. |
| **Favourites** | Only works if the semantics are actually ranked/preferred, which they are not — this is audience selection, not preference. Listed to be ruled out. |
| **Close Circles** | Keeps the warm word while distinguishing it. But `/friends` already has a "Close Friends" tab, so this risks a *second* collision. |

---

## Recommendation

**Option B, renaming the `/groups` surface**, is the lower-risk change on every
measure taken: half the strings, no enum, no route, no table, and it makes four
existing internal names honest instead of one more name inconsistent.

On which name: **"Groups"** is the recommendation if the priority is clarity and
zero risk, because the whole codebase already says it and users already know what
it means. **"Crews"** is the recommendation if the priority is keeping a
distinctive voice — it is the only alternative that is both warm and unambiguous
against the rest of the product's vocabulary.

If neither side is renamed, the collision is survivable — it costs comprehension
on first encounter and nothing after that. Doing nothing is a legitimate choice
and is cheaper than either rename.

**No code has been changed for this finding.**
