import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNLIMITED, entitlementsFor, upgradePromptFor } from "@/lib/billing/entitlements";
import {
  composeArrivalMs,
  contactCoverageSummary,
  durationUntilLabel,
  safeArrivalLimitsFor,
  safeArrivalNotification,
  validateContactCount,
  validateExpectedArrival
} from "@/lib/safety/safe-arrival";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Code with comments removed.
 *
 * Block comments are stripped as SPANS, not line by line. A line-based filter
 * misses JSX comments (`{/* ... *\/}`) and every continuation line of a
 * multi-line block, which meant a rule about user-visible copy was matching the
 * prose explaining why that copy was changed.
 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/** A local wall-clock instant, so these tests hold in any machine timezone. */
const localAt = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

// ---------------------------------------------------------------------------
// The bug that made "later today" impossible
// ---------------------------------------------------------------------------

describe("arrival time composition", () => {
  it("accepts a future time LATER TODAY", () => {
    // The exact reported case: 6:00 PM now, 9:00 PM today.
    const now = localAt(2026, 7, 30, 18, 0);
    const arrival = composeArrivalMs({ dayOffset: 0, time: "21:00", nowMs: now });

    expect(Number.isFinite(arrival)).toBe(true);
    expect(arrival).toBeGreaterThan(now);
    // Same calendar day, not pushed to tomorrow.
    expect(new Date(arrival).getDate()).toBe(new Date(now).getDate());
    expect(validateExpectedArrival(arrival, now)).toBeNull();
  });

  it("rejects a time earlier today, and only because it is in the past", () => {
    const now = localAt(2026, 7, 30, 18, 0);
    const arrival = composeArrivalMs({ dayOffset: 0, time: "09:00", nowMs: now });
    expect(validateExpectedArrival(arrival, now)).toBe("Choose an arrival time in the future.");
  });

  it("treats today's date as valid in itself: only the instant matters", () => {
    const now = localAt(2026, 7, 30, 18, 0);
    // One minute from now, same day, is acceptable.
    expect(validateExpectedArrival(composeArrivalMs({ dayOffset: 0, time: "18:01", nowMs: now }), now)).toBeNull();
    // The current minute is not: the rule is strictly `<= now` is rejected.
    expect(validateExpectedArrival(composeArrivalMs({ dayOffset: 0, time: "18:00", nowMs: now }), now)).not.toBeNull();
  });

  it("handles tomorrow, month rollover and the midnight boundary", () => {
    const now = localAt(2026, 7, 31, 23, 30);
    const tomorrow = composeArrivalMs({ dayOffset: 1, time: "00:15", nowMs: now });
    expect(validateExpectedArrival(tomorrow, now)).toBeNull();
    // 31 July + 1 day must roll into August, not become the 32nd.
    expect(new Date(tomorrow).getMonth()).toBe(7);
    expect(new Date(tomorrow).getDate()).toBe(1);

    // Midnight today is in the past by 23:30; midnight tomorrow is not.
    expect(validateExpectedArrival(composeArrivalMs({ dayOffset: 0, time: "00:00", nowMs: now }), now)).not.toBeNull();
    expect(validateExpectedArrival(composeArrivalMs({ dayOffset: 1, time: "00:00", nowMs: now }), now)).toBeNull();
  });

  it("round-trips through ISO/UTC without shifting the instant", () => {
    // Storage is UTC; the composed instant must survive the conversion, which is
    // what makes non-UTC travellers (Accra included) work.
    const now = localAt(2026, 7, 30, 18, 0);
    const arrival = composeArrivalMs({ dayOffset: 0, time: "21:00", nowMs: now });
    expect(Date.parse(new Date(arrival).toISOString())).toBe(arrival);
  });

  it("returns NaN for unusable input rather than a wrong instant", () => {
    const now = localAt(2026, 7, 30, 18, 0);
    for (const time of ["", "9pm", "25:00", "12:99", "abc"]) {
      expect(Number.isNaN(composeArrivalMs({ dayOffset: 0, time, nowMs: now }))).toBe(true);
    }
  });

  it("rejects a journey more than 24 hours out", () => {
    const now = localAt(2026, 7, 30, 18, 0);
    const far = now + 25 * 3600_000;
    expect(validateExpectedArrival(far, now)).toContain("24 hours");
  });
});

describe("lead-time copy", () => {
  it("describes duration only, never a place", () => {
    const now = localAt(2026, 7, 30, 18, 0);
    expect(durationUntilLabel(now + 45 * 60_000, now)).toBe("45 min");
    expect(durationUntilLabel(now + 135 * 60_000, now)).toBe("2h 15m");
    expect(durationUntilLabel(now + 120 * 60_000, now)).toBe("2h");
    expect(durationUntilLabel(now - 60_000, now)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Watcher capacity comes from the canonical entitlement registry
// ---------------------------------------------------------------------------

/**
 * Phase 0: watcher capacity is NOT a subscription feature.
 *
 * Watchers are the people who get told you did not arrive. Selling more of
 * them means charging the person in more danger, so every tier receives the
 * same permissive access. These tests replace the previous "each paid tier
 * gets a strictly higher allowance" suite.
 */
describe("safety capacity is equal on every tier", () => {
  const PLANS: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

  it("reuses the existing canonical entitlement key", () => {
    // The key already existed; a parallel `safe_arrival_max_watchers` would have
    // been a second source of truth.
    for (const plan of PLANS) {
      expect(safeArrivalLimitsFor(plan).maxContacts).toBe(entitlementsFor(plan).max_safe_arrival_contacts);
    }
  });

  it("gives every tier the same unlimited watcher allowance", () => {
    const values = PLANS.map((plan) => safeArrivalLimitsFor(plan).maxContacts);
    expect(new Set(values).size, "watcher capacity must not differ by plan").toBe(1);
    for (const value of values) expect(value).toBe(UNLIMITED);
  });

  it("gives every tier the same concurrent-journey allowance", () => {
    const values = PLANS.map((plan) => safeArrivalLimitsFor(plan).maxActiveSessions);
    expect(new Set(values).size).toBe(1);
  });

  it("does not depend on payment, trial or reward state", () => {
    // Identical across plans means no billing status, grace period, trial or
    // earned tier override can change it.
    const contacts = PLANS.map((plan) => entitlementsFor(plan).max_safe_arrival_contacts);
    expect(new Set(contacts).size).toBe(1);
  });

  it("still requires at least one watcher, on every plan", () => {
    // The one validation that survives: a journey nobody is watching is not
    // a Safe Arrival.
    for (const plan of PLANS) {
      expect(validateContactCount(0, plan), plan).not.toBeNull();
      expect(validateContactCount(1, plan), plan).toBeNull();
      // No upper bound to hit.
      expect(validateContactCount(25, plan), plan).toBeNull();
    }
  });

  it("offers no upgrade prompt anywhere in the safety path", () => {
    // The strongest form of the rule: not "the prompt is correct" but "there
    // is no prompt".
    for (const plan of PLANS) {
      expect(upgradePromptFor("max_safe_arrival_contacts", plan), plan).toBeNull();
    }
    const actions = stripComments(read("app/(app)/safe-arrival-actions.ts"));
    expect(actions).not.toContain("upgradePromptFor");

    const rules = stripComments(read("lib/safety/safe-arrival.ts"));
    expect(rules.toLowerCase()).not.toContain("upgrade");
  });

  it("is enforced server-side, not only hidden in the UI", () => {
    const actions = stripComments(read("app/(app)/safe-arrival-actions.ts"));
    expect(actions).toContain("validateContactCount");
    expect(actions).toContain("getCurrentSubscriptionAccess");
    // The wire schema must not impose a lower cap than the top plan allows: a
    // hardcoded max(5) silently truncated Buddy Pro before plan logic ran.
    // The wire schema keeps a generous OPERATIONAL ceiling — a system limit,
    // not a plan limit. It must be high enough never to act as a paywall.
    const schemaMax = /contactIds: z\.array\(uuidSchema\)\.min\(1\)\.max\((\d+)\)/.exec(actions)?.[1];
    expect(Number(schemaMax)).toBeGreaterThanOrEqual(10);
  });

  it("resolves the limit on the server and passes it down, never computing it in the component", () => {
    const page = stripComments(read("app/(app)/safe-arrival/page.tsx"));
    expect(page).toContain("safeArrivalLimitsFor");
    expect(page).toContain("maxWatchers");

    const setup = stripComments(read("components/safety/safe-arrival-setup.tsx"));
    // The component receives the number; it must not import plan tables.
    expect(setup).not.toContain("entitlementsFor");
    expect(setup).not.toContain("PLAN_ENTITLEMENTS");
    expect(setup).toContain("maxWatchers");
  });

  it("never strips watchers from an ALREADY ACTIVE journey when a plan changes", () => {
    // The cap is applied at start (and by the RPC's own check). Nothing in the
    // read path filters an existing journey's watchers by the current plan, so a
    // downgrade mid-journey cannot silently remove someone's safety cover.
    const service = stripComments(read("lib/safety/safe-arrival-service.ts"));
    expect(service).not.toContain("max_safe_arrival_contacts");
    expect(service).not.toContain("safeArrivalLimitsFor");
    expect(service).not.toContain("getCurrentSubscriptionAccess");
  });
});

// ---------------------------------------------------------------------------
// Watcher notifications
// ---------------------------------------------------------------------------

describe("watcher notification set", () => {
  const events = ["started", "extended", "overdue", "arrived", "cancelled"] as const;

  it("produces a title and message for every lifecycle event", () => {
    for (const event of events) {
      const notification = safeArrivalNotification(event, {
        travellerName: "Ama",
        destinationLabel: "Campus",
        timeLabel: "9:00 PM"
      });
      expect(notification.title.length).toBeGreaterThan(0);
      expect(notification.message.length).toBeGreaterThan(0);
    }
  });

  it("frames the start as a request to check on someone", () => {
    const notification = safeArrivalNotification("started", {
      travellerName: "Ama",
      destinationLabel: "Campus",
      timeLabel: "9:00 PM"
    });
    // An invitation, not a monitoring assignment.
    expect(notification.title).toBe("Can you check on Ama?");
    expect(notification.message).toContain("Safe Arrival contact");
    expect(notification.message).toContain("Campus");
    expect(notification.message).toContain("9:00 PM");
  });

  it("states the NEW time when a journey is extended", () => {
    const notification = safeArrivalNotification("extended", { travellerName: "Ama", timeLabel: "9:20 PM" });
    expect(notification.title).toContain("updated their arrival time");
    expect(notification.message).toContain("9:20 PM");
  });

  it("keeps the overdue alert neutral, never an emergency", () => {
    const notification = safeArrivalNotification("overdue", { travellerName: "Ama", timeLabel: "9:00 PM" });
    expect(notification.title).toBe("Ama hasn't checked in yet");
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    for (const alarmist of ["missing", "emergency", "danger", "unsafe", "urgent", "alert!", "help"]) {
      expect(text).not.toContain(alarmist);
    }
  });

  it("degrades to a useful message when no time is available", () => {
    for (const event of events) {
      const notification = safeArrivalNotification(event, { travellerName: "Ama" });
      expect(notification.message).not.toContain("undefined");
      expect(notification.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses no surveillance vocabulary in any event", () => {
    for (const event of events) {
      const notification = safeArrivalNotification(event, {
        travellerName: "Ama",
        destinationLabel: "Campus",
        timeLabel: "9:00 PM"
      });
      const text = `${notification.title} ${notification.message}`.toLowerCase();
      for (const word of ["watching", "watch over", "monitor", "tracking", "surveil"]) {
        expect(text, `${event} uses "${word}"`).not.toContain(word);
      }
    }
  });

  it("leaks no positional data in any event", () => {
    for (const event of events) {
      const notification = safeArrivalNotification(event, {
        travellerName: "Ama",
        destinationLabel: "Campus",
        timeLabel: "9:00 PM"
      });
      const text = `${notification.title} ${notification.message}`.toLowerCase();
      for (const forbidden of ["latitude", "longitude", "coordinate", "gps", "km ", "metres", "meters", "route", "speed"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it("is the single copy source for traveller actions AND the overdue job", () => {
    expect(stripComments(read("app/(app)/safe-arrival-actions.ts"))).toContain("safeArrivalNotification");
    expect(stripComments(read("lib/jobs/handlers.ts"))).toContain('safeArrivalNotification("overdue"');
  });
});

describe("notification delivery is server-side and deep-linkable", () => {
  const actions = stripComments(read("app/(app)/safe-arrival-actions.ts"));

  it("fans out to every watcher who has not declined", () => {
    expect(actions).toContain('.neq("acknowledgement_status", "declined")');
    expect(actions).toContain("deliverNotification");
  });

  it("stamps the session id so a tap opens the exact journey", () => {
    expect(actions).toContain("type: `safe_arrival:${sessionId}`");
    // The resolver turns that into the per-journey URL rather than the root.
    const destination = read("lib/notifications/destination.ts");
    expect(destination).toContain('withQuery("/safe-arrival", "session", entityId)');
  });

  it("creates in-app rows in the request path, so correctness never rides on Realtime", () => {
    const notify = actions.slice(actions.indexOf("async function notifyWatchers"));
    const body = notify.slice(0, notify.indexOf("\n}"));
    expect(body).toContain("await Promise.all");
    expect(body).not.toContain("after(");
  });

  it("does not build a second notification system", () => {
    // One transport, one preference store: deliverNotification.
    expect(actions).not.toContain("push_subscriptions");
    expect(actions).not.toContain("sendPushToUser");
    expect(actions).not.toContain("from(\"notifications\")");
  });

  it("notifies arrival exactly once, guarded on a real status transition", () => {
    const confirm = actions.slice(actions.indexOf("export async function confirmSafeArrivalAction"));
    const body = confirm.slice(0, confirm.indexOf("\n// ---"));
    // The guarded update returns no rows on a duplicate confirm, and the
    // notification sits after that early return.
    expect(body).toContain('.in("status", ["active", "grace_period", "extended", "unconfirmed"])');
    expect(body.indexOf("if (!updated?.length)")).toBeLessThan(body.indexOf("notifyWatchers"));
  });

  it("rate limits repeated extension notifications without dropping the new time", () => {
    const extend = actions.slice(actions.indexOf("export async function extendSafeArrivalAction"));
    const body = extend.slice(0, extend.indexOf("\n// ---"));
    // The write is unconditional; only the notify is behind the cooldown.
    expect(body.indexOf("expected_arrival_at: nextArrivalIso")).toBeLessThan(body.indexOf("withinCooldown"));
    expect(body).toContain("if (!withinCooldown)");
  });
});

// ---------------------------------------------------------------------------
// Atomic start
// ---------------------------------------------------------------------------

describe("atomic journey start", () => {
  const migration = read("supabase/migrations/20260730160000_safe_arrival_atomic_start.sql");

  it("creates the journey, its watchers and the audit row in one function", () => {
    expect(migration).toContain("create or replace function public.start_safe_arrival");
    expect(migration).toContain("insert into public.safe_arrival_sessions");
    expect(migration).toContain("insert into public.safe_arrival_contacts");
    expect(migration).toContain("insert into public.safe_arrival_events");
  });

  it("is a hardened security definer", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    // Not callable by a logged-in client, which could otherwise pass another
    // traveller's id or its own p_max_active.
    expect(migration).toContain("from authenticated");
    expect(migration).toContain("to service_role");
  });

  it("re-asserts watcher eligibility in SQL", () => {
    // Approved mutual Muddy, unblocked either way, and not silently opted out.
    expect(migration).toContain("public.friendships");
    expect(migration).toContain("public.blocked_users");
    expect(migration).toContain("public.safe_arrival_blocks");
    expect(migration).toContain("safe_arrival_no_watchers");
  });

  it("checks the active-journey cap inside the transaction", () => {
    expect(migration).toContain("safe_arrival_active_limit");
    expect(migration).toContain("p_max_active");
  });

  it("replays a duplicate submit instead of creating a second journey", () => {
    expect(migration).toContain("interval '2 minutes'");
    expect(migration).toMatch(/if v_session_id is not null then\s*\n\s*return v_session_id;/);
  });

  it("stores no coordinates: destination is a label and nothing more", () => {
    for (const forbidden of ["latitude", "longitude", "geography", "geometry", "point(", "st_"]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("is additive: no table, column or policy is dropped or altered", () => {
    const sql = migration.toLowerCase();
    expect(sql).not.toMatch(/\ndrop table/);
    expect(sql).not.toMatch(/\nalter table/);
    expect(sql).not.toMatch(/\ndrop policy/);
  });

  it("is used by BOTH the web action and the mobile API", () => {
    expect(stripComments(read("app/(app)/safe-arrival-actions.ts"))).toContain('rpc("start_safe_arrival"');
    expect(stripComments(read("lib/safety/safe-arrival-mobile.ts"))).toContain('rpc("start_safe_arrival"');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle / UI wiring
// ---------------------------------------------------------------------------

describe("start hands back the active journey", () => {
  const actions = stripComments(read("app/(app)/safe-arrival-actions.ts"));
  const page = stripComments(read("components/safety/safe-arrival-page.tsx"));

  it("returns the canonical journey from create, so no refresh is needed", () => {
    expect(actions).toContain("loadSafeArrivalJourneyById");
    expect(actions).toContain("journey");
  });

  it("closes the setup sheet only after a confirmed success", () => {
    const handler = page.slice(page.indexOf("function handleStart"));
    const body = handler.slice(0, handler.indexOf("\n  }"));
    // The failure branch returns before the close.
    expect(body.indexOf("if (!result.ok)")).toBeLessThan(body.indexOf("setSetupOpen(false)"));
    expect(body).toContain("setSetupError(result.message)");
  });

  it("keeps the form open with its values on failure", () => {
    const setup = stripComments(read("components/safety/safe-arrival-setup.tsx"));
    // Reset happens on CLOSE only, never on a failed submit.
    expect(setup).toContain("if (!next) reset();");
    const submitRegion = setup.slice(setup.indexOf("onSubmit({"));
    expect(submitRegion.slice(0, 400)).not.toContain("reset()");
  });

  it("does not gate the active screen behind a Realtime event", () => {
    const hook = stripComments(read("hooks/use-journey-realtime.ts"));
    // Realtime only ever triggers a canonical refetch; it renders nothing.
    expect(hook).toContain("router.refresh()");
    expect(page).toContain("setOptimistic(result.journey");
  });
});

describe("traveller sees who actually accepted", () => {
  const service = stripComments(read("lib/safety/safe-arrival-service.ts"));

  it("models all three contact states explicitly", () => {
    for (const state of ['"invited"', '"accepted"', '"declined"']) {
      expect(service).toContain(state);
    }
    // The previous read kept only accepted rows, so a fresh journey showed none.
    expect(service).not.toMatch(/filter\([^)]*acknowledgement_status === "watching"\)/);
  });

  it("derives counts from canonical status, never from the invite list", () => {
    expect(service).toContain("acceptedCount");
    expect(service).toContain("invitedCount");
    const fn = service.slice(service.indexOf("function contactCounts"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // acceptedCount counts ONLY accepted; invited is reported separately.
    expect(body).toContain('row.state === "accepted"');
    expect(body).toContain('row.state === "invited"');
  });

  it("never counts an invitation as somebody checking in", () => {
    // 3 invited / 2 accepted must read as 2 confirmed, 1 awaiting.
    const summary = contactCoverageSummary({ acceptedCount: 2, invitedCount: 1 });
    expect(summary.headline).toBe("2 Muddies are checking in on you");
    expect(summary.detail).toBe("2 confirmed · 1 awaiting response");
    expect(`${summary.headline} ${summary.detail}`).not.toContain("3");
  });

  it("says nobody is confirmed yet when only invitations are out", () => {
    const summary = contactCoverageSummary({ acceptedCount: 0, invitedCount: 3 });
    expect(summary.headline).toBe("Waiting for your Muddies");
    expect(summary.detail).toBe("3 invitations sent");
  });

  it("switches to a singular confirmed count after one acceptance", () => {
    const summary = contactCoverageSummary({ acceptedCount: 1, invitedCount: 2 });
    expect(summary.headline).toBe("1 Muddy is checking in on you");
    expect(summary.detail).toBe("1 confirmed · 2 awaiting response");
  });

  it("takes counts as props rather than measuring the avatar list", () => {
    const parts = stripComments(read("components/safety/journey-parts.tsx"));
    // Anchored to the next top-level export, NOT to the first "\n}": the
    // destructured props block ends with `}: {` at column zero, which closed the
    // window before the body and made this assertion pass on nothing.
    const start = parts.indexOf("export function ContactStrip");
    const next = parts.indexOf("\nexport ", start + 1);
    const body = parts.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("return (");
    // Privacy filtering can shorten the visible list, so its length is not the
    // count. The canonical numbers arrive as props.
    expect(body).toContain("acceptedCount");
    expect(body).toContain("invitedCount");
    expect(body).not.toMatch(/contacts\.filter\([^)]*\)\.length/);
    expect(body).toContain('contact.state === "accepted"');
    // State is also announced, so the check badge is not the only carrier.
    expect(body).toContain("sr-only");
  });
});

describe("watcher deep link opens the journey", () => {
  const page = stripComments(read("components/safety/safe-arrival-page.tsx"));
  const route = stripComments(read("app/(app)/safe-arrival/page.tsx"));

  it("resolves ?session= to a watcher view before the viewer's own empty state", () => {
    expect(page).toContain("watcherFocus");
    expect(page).toContain("requestedSessionId");
    // The watcher branch is chosen first in the render chain.
    expect(page.indexOf("watcherFocus ? (")).toBeLessThan(page.indexOf("<SafeArrivalHome"));
  });

  it("loads a terminal journey too, so an arrival notification is not a dead end", () => {
    expect(route).toContain("loadSafeArrivalJourneyById");
    const service = read("lib/safety/safe-arrival-service.ts");
    const fn = service.slice(service.indexOf("export async function loadSafeArrivalJourneyById"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    // No live-status filter on this read.
    expect(body).not.toContain("LIVE_SAFE_ARRIVAL_STATUSES");
  });

  it("navigates to a same-pathname query with a real document load", () => {
    // NavigationWatchdog arms on any same-origin anchor click and clears only on
    // a usePathname() change. /safe-arrival?session=x from /safe-arrival keeps
    // the same pathname, so a client-side Link would leave it armed and fire a
    // false "navigation did not complete" warning. A plain anchor unmounts the
    // watchdog with the page instead.
    const watchdog = read("components/navigation/navigation-watchdog.tsx");
    expect(watchdog).toContain("const pathname = usePathname();");
    expect(watchdog).toContain('a[href]');

    const row = page.slice(page.indexOf("function WatchingSummaryRow"));
    const body = row.slice(0, row.indexOf("\n}"));
    expect(body).toContain("href={`/safe-arrival?session=${journey.id}`}");
    expect(body).not.toContain("<Link");
  });

  it("re-checks access, so an id belonging to somebody else resolves to nothing", () => {
    const service = read("lib/safety/safe-arrival-service.ts");
    const fn = service.slice(service.indexOf("export async function loadSafeArrivalJourneyById"));
    expect(fn.slice(0, 400)).toContain("resolveSafeArrivalAccess");
    expect(fn.slice(0, 400)).toContain("if (!access.canView) return null;");
  });
});

describe("active-journey history hygiene", () => {
  it("only genuinely live journeys count as active", () => {
    const service = read("lib/safety/safe-arrival-service.ts");
    const live = service.slice(
      service.indexOf("export const LIVE_SAFE_ARRIVAL_STATUSES"),
      service.indexOf("];", service.indexOf("export const LIVE_SAFE_ARRIVAL_STATUSES"))
    );
    for (const terminal of ["completed", "cancelled", "expired"]) {
      expect(live).not.toContain(`"${terminal}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("no location anywhere in the feature surface", () => {
  const files = [
    "components/safety/safe-arrival-page.tsx",
    "components/safety/safe-arrival-setup.tsx",
    "components/safety/journey-parts.tsx",
    "lib/safety/safe-arrival-service.ts",
    "app/(app)/safe-arrival-actions.ts",
    "app/(app)/safe-arrival/page.tsx"
  ];

  it("reads no coordinate or geolocation API", () => {
    for (const file of files) {
      const code = stripComments(read(file));
      for (const forbidden of [
        "latitude",
        "longitude",
        "coordinates",
        "geolocation",
        "watchPosition",
        "getCurrentPosition"
      ]) {
        expect(code, `${file} references ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("reads no movement or distance FIELD", () => {
    // Matched as identifiers/properties rather than as bare words: the setup
    // form legitimately asks "Where are you heading?", which is the English verb,
    // not a compass bearing. A substring test would flag that copy and would
    // have to be weakened, so it is scoped to real field access instead.
    const fieldPatterns = [
      /\bheading\s*[:=]/,
      /\.heading\b/,
      /\bspeed\s*[:=]/,
      /\.speed\b/,
      /\bdistanceMeters\b/,
      /\bdistance\s*[:=]/,
      /\.distance\b/,
      /\baccuracy\s*[:=]/
    ];
    for (const file of files) {
      const code = stripComments(read(file));
      for (const pattern of fieldPatterns) {
        expect(code, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("introduces no map", () => {
    for (const file of files) {
      const code = read(file).toLowerCase();
      for (const forbidden of ["mapbox", "leaflet", "google.maps", "react-map"]) {
        expect(code, `${file} references ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the journey visual decorative, so it cannot read as a live marker", () => {
    const parts = read("components/safety/journey-parts.tsx");
    const visual = parts.slice(parts.indexOf("export function JourneyVisual"));
    expect(visual.slice(0, 1400)).toContain('aria-hidden="true"');

    // The dashed path drifts at a constant rate and is never driven by data.
    const css = read("app/globals.css");
    const dash = css.slice(css.indexOf(".journey-scene-dash"), css.indexOf("}", css.indexOf("@keyframes journey-dash")));
    expect(dash).toContain("linear infinite");
    expect(dash).not.toContain("var(--journey-progress");
  });

  it("logs no destination text, note or location in analytics", () => {
    const actions = read("app/(app)/safe-arrival-actions.ts");
    // Anchored on the CALL, not the import of the same name, and every call is
    // checked rather than just the first.
    const calls = [...actions.matchAll(/recordProductEvent\(admin, \{[\s\S]*?\}\);/g)].map((match) => match[0]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call).toContain("resourceId: sessionId");
      expect(call).not.toContain("destinationLabel");
      expect(call).not.toContain("note");
      expect(call).not.toContain("expectedArrival");
    }
  });
});

// ---------------------------------------------------------------------------
// Reduced motion + accessibility
// ---------------------------------------------------------------------------

describe("restrained animation", () => {
  const css = read("app/globals.css");

  it("disables every journey animation under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".journey-scene")));
    expect(reduced).toContain("journey-scene-dash");
    expect(reduced).toContain("journey-pin-breathe");
    expect(reduced).toContain("animation: none");
  });

  it("also gates motion in JS, not only in CSS", () => {
    const parts = stripComments(read("components/safety/journey-parts.tsx"));
    expect(parts).toContain("useReducedMotion");
  });

  it("uses slow ambient timing rather than a radar sweep", () => {
    const dash = /\.journey-scene-dash \{ animation: journey-dash (\d+)s/.exec(css);
    expect(Number(dash?.[1])).toBeGreaterThanOrEqual(6);
  });
});

describe("watcher selection accessibility", () => {
  const setup = stripComments(read("components/safety/safe-arrival-setup.tsx"));

  it("announces selection state rather than relying on colour", () => {
    expect(setup).toContain("aria-pressed={isSelected}");
    expect(setup).toContain('{isSelected ? "Selected" : "Not selected"}');
  });

  it("announces the limit instead of silently disabling rows", () => {
    expect(setup).toContain('aria-live="polite"');
    expect(setup).toContain("limitNotice");
    // Over-limit rows stay operable so a tap can explain why.
    expect(setup).not.toContain("disabled={atLimit}");
  });

  it("keeps day and grace choices as real radio groups", () => {
    expect(setup).toContain('role="radiogroup"');
    expect(setup).toContain("aria-checked={dayOffset === option.offset}");
    expect(setup).toContain("aria-checked={grace === minutes}");
  });

  it("explains a rejected time instead of just disabling Next", () => {
    expect(setup).toContain("Choose a time later than now.");
    expect(setup).toContain("That's in ");
  });
});
