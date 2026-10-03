# C2 audit — UpFor scheduling + free 3-concurrent allowance
Base b4035b9. Read-only audit, no schema decision taken yet.

## TIME AUTHORITY (existing, sound — reuse)
hangout_sessions.starts_at  timestamptz NOT NULL DEFAULT now()
hangout_sessions.ends_at    timestamptz NOT NULL
CHECK hangout_ends_after_start (ends_at > starts_at)

`starts_at` ALREADY EXISTS and is already the start authority. A scheduled
UpFor is therefore expressible with NO new timestamp column: "Later today"
writes a future starts_at instead of defaulting to now().

## STATUS AUTHORITY
CHECK: draft | active | paused | full | expired | cancelled | converted_to_plan
LIVE_HANGOUT_STATUSES = [active, paused, full]   (lib/social/planning.ts:130)

There is NO `scheduled` status, and per the brief there should not be one:
scheduled vs active is DERIVABLE from timestamps
  SCHEDULED  now < starts_at
  ACTIVE     starts_at <= now < ends_at
  TERMINAL   expired | cancelled | converted_to_plan
Adding a stored `scheduled` status would create a second, contradictable
authority for a fact the timestamps already carry.

## TIMEZONE AUTHORITY (partial — the real gap)
- hangout_sessions has NO timezone column.
- plans.timezone text NOT NULL DEFAULT 'UTC' exists as precedent, but is
  validated only as `z.string().max(60)` — NOT checked to be a real IANA zone.
- lib/notifications/preferences.ts ALREADY has the correct primitives:
    dayKeyInTimeZone(date, tz)     -> "YYYY-MM-DD" via Intl "en-CA"
    minuteOfDayInTimeZone(date, tz)
    DEFAULT_RECIPIENT_TIMEZONE = "Africa/Accra"
  These use platform Intl — no date library needed, satisfying PERFORMANCE.

=> Same-day validation needs a timezone for the UpFor. Either store it on the
   row (mirroring plans.timezone) or resolve it server-side. Either way the
   supplied zone must be VALIDATED as IANA, which plans currently does not do.

## ALLOWANCE (two real defects)
1. UpFor is currently PAID-ONLY: startHangoutAction calls
   checkAccess(userId, "upfor"); PaidSurface = "linkr" | "upfor".
   The C2 product change (free users get 3 concurrent) crosses this gate.
2. THE EXISTING CEILING IS ALREADY RACY — the exact pattern the brief forbids:
       if ((await activeHangoutCount(admin, userId)) >= MAX_ACTIVE_UPFORS)
       ... later ... admin.from("hangout_sessions").insert(...)
   Two independent operations, no atomicity. MAX_ACTIVE_UPFORS = 3 already,
   framed as flat anti-abuse rather than monetization.
   activeHangoutCount() counts status IN (active,paused,full) AND ends_at > now,
   after sweepExpiredHangouts() — so terminal rows are already excluded, which
   matches the required slot semantics. It does NOT yet exclude/include
   scheduled rows correctly, because scheduled rows do not exist yet.

## CONVERSION
convertHangoutToPlanAction (hangout-actions.ts:1295) — must keep using the
canonical create_plan_lifecycle; no second path. converted_plan_id FK exists.

## HOME
"Upcoming Plans" title lives at components/hangout/hangout-mode-page.tsx:886.
dashboard-page.tsx:1146 references it in a comment. structured-share-v4 uses
the phrase in unrelated body copy (NOT the Home section) — do not rename that.

## OWNER DECISION (2026-08-30)
UpFor REMAINS PAID. checkAccess(userId, "upfor") stays exactly as it is.
The 3-concurrent ceiling is a flat anti-abuse limit for people who already
have Access -- not a free tier and not monetization. So C2 does NOT touch the
access boundary, does NOT introduce a free allowance, and the ONLY allowance
work is making the existing racy ceiling atomic.

That removes the PaidSurface change, the free-tier copy, and the tier-divergent
limit from scope.

## CONCLUSION
Minimal migration surface: a timezone column (+ IANA validation) and an atomic
allowance authority. `starts_at` and the status enum need no new values.
