# Visual asset manifest

Every image in `assets/MadBuddy_Visual_Asset_Library`, with what it **actually
depicts** (verified by looking at it, not by reading its filename), the verdict,
and why.

Source material is not automatically production content. **10 of 55 images
ship**; the other 45 stay in the library.

Everything under `public/visuals/` has a rendering consumer. Five approved
images were removed again during review precisely because they did not:
`home-ambient-morning`, `home-ambient-afternoon`, `safe-arrival-ready`,
`safe-arrival-attention` and `activity-hangout-general-master`. A shipped file
with no job is an invitation to find it one.

---

## Shipped (10)

### Plan activity photography — 8

Layered in front of the canonical CSS cover, never replacing it.

| File | Depicts | Category | Notes |
|---|---|---|---|
| `activity-coffee-master` | Two people over coffee in a cafe | `coffee` | |
| `activity-beach-swim-master` | Friends on a beach at golden hour | `beach` | |
| `activity-food-dinner-master` | Group dinner, warm restaurant | `dinner` | |
| `activity-football-sports-master` | Five-a-side match at sunset | `football` | Plain kit, no club marks |
| `activity-picnic-outdoors-master` | Four friends on a picnic blanket | `picnic` | |
| `activity-party-night-master` | People dancing at a night party | `party` | |
| `activity-movie-master` | Two people in a cinema | `movie` | |
| `activity-music-master` | Crowd facing a lit stage | `concert` | |

### Safe Arrival — 2

Abstract light and particles. No map, route, pin or distance appears in either,
which is why they are safe on this surface at all. Keyed to the REAL lifecycle,
not to the filenames:

| File | Journey state | Canonical status |
|---|---|---|
| `safe-arrival-active` | `in_transit` | `active`, `extended`, `grace_period` |
| `safe-arrival-complete` | `arrived` | `completed` |

**Four states carry no artwork, deliberately.**

- `waiting` (`unconfirmed`) — the lifecycle defines this as *"neutral by
  construction: it reports 'hasn't confirmed yet', never 'missing', and never
  implies an emergency"*. It asks nothing of the traveller, who may simply have
  no signal. The `attention` image would contradict that in the one place where
  being wrong frightens somebody, so it does not ship.
- `starting` — the setup screen renders `tone="transit"`, so a starting-specific
  image had no route to a screen. `safe-arrival-ready` does not ship.
- `cancelled` / `expired` — endings. Artwork would make a closed session look
  live.

### Home ambient — 0

`home-ambient-morning` and `home-ambient-afternoon` both passed review, and
neither had a consumer: Home quiet-state integration has not been designed. Both
were removed from `/public` and deferred.

---

## Rejected — baked UI (6)

**All six "empty state" images are fake app screens, and every one is
mislabelled.** They contain readable headings, body copy, fake list rows with
chevrons, and in three cases a complete fake bottom navigation bar. Using any of
them would put a screenshot where an interface belongs — and none of them
matches the product area its filename claims.

| File | Actually depicts | Defects |
|---|---|---|
| `empty-events` | **Plans** | Heading, body copy, 6 fake pill buttons |
| `empty-plans` | **Circles** | Heading, copy, fake pills, generated faces with baked Glow rings |
| `empty-linkr` | **UpFor** | Full fake app screen incl. bottom nav; off-brand purple; fake logo |
| `empty-upfor` | **Moments** | Fake video cards with play buttons and durations; off-brand purple |
| `empty-groups` | **Messages** | Full fake app screen incl. bottom nav; fake logo |
| `media-fallback-general` | Events empty state | Full fake app screen incl. bottom nav |

Empty states remain real React: illustration (optional) + real heading + real
copy + real functional CTA. `empty-upfor` depicting Moments is further evidence
of mis-generation; Moments receives nothing.

## Rejected — trademarks (4)

Semantic mapping is possible for these, which is exactly why they are listed:
a correct category does not make a trademark shippable.

| File | Depicts | Problem |
|---|---|---|
| `activity-study-master` | Library study session | Apple logo on laptop |
| `activity-gym-fitness-master.jpg.png` | Gym session | Nike marks on socks/shoes; also 2.6 MB and a double extension |
| `group-sports-fallback` | **Studying** — books, laptop, library cafe | Wrong content *and* an Apple logo |
| `event-sports-fallback` | Football | Adidas stripes and club crests |

## Rejected — off-brand (3)

| File | Depicts | Problem |
|---|---|---|
| `home-ambient-evening` | Cobalt gradient | Near-monochrome blue against a warm product |
| `home-ambient-night` | Deep blue gradient | Same |
| `journey-streak` | **Blue security shield** | Safe Arrival iconography, not a streak; off-brand blue |

## Deferred — no category authority (18)

12 event + 8 group fallbacks, minus the 2 already rejected above.

Neither `events` nor `groups` has a `category` column. Wiring this artwork would
have required inventing a taxonomy and a migration to justify the pictures —
the asset library dictating the data model. They stay available for future
product work.

Two content problems to carry forward when that work happens:

- `event-general-fallback` depicts a **painting class**, not anything general
- `event-creative-fallback` also depicts a **painting class** — so there is no
  true general Event fallback in the library

## Not yet reviewed / unwired (5)

`activity-gaming`, `activity-drive-roadtrip`, `activity-shopping`,
`activity-travel-adventure` (depicts a solo mountain summit — closer to
`hiking` than `travel`, and less social than the wired set), and the remaining
Journey pieces. Journey is wired asset-by-asset only after each one passes
semantic QA; `journey-streak` already failed.

---

## Regeneration manifest

### P0 — blocking a feature's visual lock

The three Linkr orb assets. Referenced by `components/linkr/linkr-orb.tsx`,
absent from `/public`, and with no candidate anywhere in the library. The
component probes for each file and falls back to a placeholder that reserves the
same box, so their absence costs a probe rather than a broken layout.

- `/public/linkr/orb-off.png` — orbital "people around you" mark
- `/public/linkr/orb-activate.png` — two-figure connection glyph
- `/public/linkr/orb-empty.png` — searching mark

Nothing was substituted for these.

### P1 — the empty-state system

All six rejected concepts, regenerated as **artwork only**: no text, no
headings, no buttons, no list rows, no navigation bars, no logos, no faces. The
React layer supplies every word and every control. Each also needs to be
generated for the product area it is named after.

### P2 — off-brand and mismatched

- Home evening + night, in the warm palette
- `journey-streak`, depicting an actual streak
- The four trademark images, reshot without brand marks
- A genuine general Event fallback (both current candidates are painting classes)
