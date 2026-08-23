import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The Event Linkr consent SEAM, and the order its checks run in.
 *
 * MB-GOD-028 proved the eligibility RULES behaviourally (the decision function
 * is pure). This covers the wiring around them, which is where the rules could
 * be correct and the system still wrong:
 *
 *   - eligibility is recomputed on every call, never cached
 *   - the checks run in an order where each one can actually deny
 *   - Linkr consumes the Events authority instead of re-deriving consent
 *   - the seam FAILS CLOSED when the consent module is absent
 *   - granting consent requires presence; withdrawing it never does
 *
 * These are source-level assertions, and that limitation is stated rather than
 * glossed: `resolveEventLinkrEligibility` needs a live database and
 * `server-only`, so the behavioural half is covered by
 * scripts/hardening/seq-event-wiring.mjs (9/9 against real rows).
 */

const CONSENT = "lib/events/linkr-consent.ts";
const ADAPTER = "lib/linkr/event-mode-adapter.ts";
const CANDIDATES = "lib/linkr/candidate-service.ts";

describe("Event Linkr consent wiring", () => {
  const consent = stripComments(readFileSync(CONSENT, "utf8"));
  const adapter = stripComments(readFileSync(ADAPTER, "utf8"));
  const candidates = stripComments(readFileSync(CANDIDATES, "utf8"));

  function body(source: string, name: string): string {
    const start = source.indexOf(`export async function ${name}`);
    expect(start, `${name} not found — did it move or get renamed?`).toBeGreaterThan(-1);
    const next = source.indexOf("export async function ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it("eligibility is resolved fresh from the database, not from a cached flag", () => {
    /* The property that makes every revocation immediate: there is no stored
       "is eligible" column to go stale. Liveness, check-in and consent are each
       read at the moment the question is asked. */
    const resolve = body(consent, "resolveEventLinkrEligibility");
    expect(resolve).toContain('.from("events")');
    expect(resolve).toContain("liveCheckIn");
    expect(resolve).toContain("hasEventLinkrConsent");
  });

  it("checks run in an order where each one can deny", () => {
    const resolve = body(consent, "resolveEventLinkrEligibility");
    const liveness = resolve.indexOf("event_not_live");
    const checkIn = resolve.indexOf("not_checked_in");
    const noConsent = resolve.indexOf("no_consent");

    expect(liveness).toBeGreaterThan(-1);
    expect(checkIn).toBeGreaterThan(-1);
    expect(noConsent).toBeGreaterThan(-1);

    // A dead Event denies before check-in is even considered, and check-in
    // denies before consent. Reordering would not change the verdict, but it
    // would change the REASON — and the reason is what the UI explains.
    expect(liveness).toBeLessThan(checkIn);
    expect(checkIn).toBeLessThan(noConsent);
  });

  it("granting consent requires a live check-in; withdrawing it never does", () => {
    /* The asymmetry is deliberate and safety-relevant: consenting to meet
       people at an Event you have not arrived at is not a decision anyone needs
       to make in advance, but withdrawal must never be harder than granting —
       including for someone who has already left. */
    const setter = body(consent, "setEventLinkrConsent");
    const guard = setter.indexOf("if (enabled)");
    const checkInCall = setter.indexOf("liveCheckIn");
    expect(guard).toBeGreaterThan(-1);
    expect(checkInCall).toBeGreaterThan(guard);
  });

  it("Linkr consumes the Events authority and re-derives none of it", () => {
    // Linkr must not decide who is checked in or who consented. It intersects.
    expect(candidates).toContain("eventModeCandidateIds");
    expect(candidates).not.toContain('from("event_linkr_opt_ins")');
    expect(candidates).not.toContain('from("check_ins")');
  });

  it("the seam fails CLOSED when the consent module is unavailable", () => {
    /* The single most important line in the adapter. "No consent module" must
       mean "no Event Mode", never "assume everyone consented" — an absent
       dependency must not become an open door. */
    expect(adapter).toContain('reason: "consent_module_unavailable"');

    /* Assert the EMPTY-set return specifically, on the guard line itself.
       A first version checked only that `return new Set()` appeared somewhere
       in the function, and mutation testing caught it: changing the guard to
       `return new Set([viewerId])` — which fails OPEN by seeding the pool with
       a real id — still passed, because the string survived elsewhere. The
       guard is now read as its own line. */
    const guardLines = adapter
      .split(String.fromCharCode(10))
      .filter((line) => /if \(!mod\)/.test(line));
    expect(guardLines.length, "the module-absent guards moved or were removed").toBeGreaterThanOrEqual(2);
    for (const line of guardLines) {
      /* Three guards exist and they fail closed in three different shapes,
         because they return three different things: an eligibility verdict, a
         candidate SET, and a display string. describeEventLinkrPool returns
         COPY, not access — it cannot leak anything, so demanding an empty Set
         from it would be wrong. What must never happen is a guard returning a
         NON-EMPTY set or an eligible verdict when the consent module is gone. */
      const leaksAccess =
        /return new Set\(\s*\[[^\]]/.test(line) ||
        /eligible:\s*true/.test(line);
      expect(leaksAccess, `a module-absent guard fails OPEN: ${line.trim()}`).toBe(false);
    }
  });

  it("an empty candidate set short-circuits rather than falling through", () => {
    // Without this, an Event with nobody consenting would fall through to the
    // ordinary Linkr pool — turning Event Mode into a way to widen discovery
    // rather than narrow it.
    expect(candidates).toContain("if (eventAttendeeIds.size === 0) return []");
  });

  it("Event Mode narrows the pool by intersection, never by widening it", () => {
    // The candidate query is filtered BY the attendee set; the set is never
    // used to add anyone.
    expect(candidates).toContain('poolQuery.in("user_id", [...eventAttendeeIds])');
  });

  it("a viewer's own Event Mode setting is honoured alongside the Event's", () => {
    // Both sides must agree: the Event consented them AND they left their own
    // user-level Event Mode on.
    expect(candidates).toContain("event_mode_enabled");
  });
});
