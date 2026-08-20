import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { describeEventLinkrPool, EVENT_LINKR_COUNT_THRESHOLD } from "@/lib/events/linkr-consent";

/**
 * Three permissions that must never be conflated.
 *
 *   check-in     "I am here."
 *   Event Glow   "Show my Muddies I am here."
 *   Event Linkr  "Show my profile to strangers at this Event."
 *
 * Arriving somewhere is not consent to be discovered, and telling your friends
 * is not either. These tests exist because Event Mode previously granted
 * stranger discovery on check-in alone.
 */

const consent = stripComments(readFileSync("lib/events/linkr-consent.ts", "utf8"));
const discover = stripComments(readFileSync("app/(app)/discover/page.tsx", "utf8"));
/* INTEGRATION (Events 2.0 + Linkr 2.0). Linkr moved the product to /linkr and
 * turned /discover into a redirect, so the Event Mode gate these tests guard
 * moved with it. The gate was not weakened by the move -- it was tightened:
 * /linkr re-resolves ?eventId= server-side through
 * lib/linkr/event-mode-adapter, which delegates to the SAME
 * resolveEventLinkrEligibility ladder (event exists -> live -> real check-in ->
 * explicit opt-in). Asserting against the redirect stub would prove nothing. */
const linkrPage = stripComments(readFileSync("app/(app)/linkr/page.tsx", "utf8"));
const modeAdapter = stripComments(readFileSync("lib/linkr/event-mode-adapter.ts", "utf8"));
const sheet = stripComments(readFileSync("components/events/meet-people-sheet.tsx", "utf8"));

describe("consent is its own permission", () => {
  it("never reads Event Glow to decide stranger discovery", () => {
    // event_glow_enabled means "show my Muddies". Reusing it here would
    // silently convert one consent into a different one.
    expect(consent).not.toContain("event_glow_enabled");
  });

  it("stores consent in its own table", () => {
    expect(consent).toContain('.from("event_linkr_opt_ins")');
  });

  it("requires a live check-in before consent can be turned on", () => {
    const setter = consent.slice(consent.indexOf("export async function setEventLinkrConsent"));
    expect(setter).toContain("liveCheckIn(");
    expect(setter).toContain("Check in first");
  });

  it("always allows turning consent off", () => {
    // Withdrawal must never be harder than granting -- someone who has left
    // should still be able to revoke.
    const setter = consent.slice(consent.indexOf("export async function setEventLinkrConsent"));
    const guard = setter.slice(0, setter.indexOf('.from("event_linkr_opt_ins")'));
    expect(guard).toContain("if (enabled) {");
  });
});

describe("eligibility is derived, never stored", () => {
  const resolver = consent.slice(consent.indexOf("export async function resolveEventLinkrEligibility"));

  it("requires the Event to be live", () => {
    expect(resolver).toContain('event.status !== "cancelled"');
    expect(resolver).toContain("Date.parse(event.ends_at) > Date.now()");
  });

  it("requires a live check-in, so checking out removes you immediately", () => {
    expect(resolver).toContain("liveCheckIn(");
    expect(resolver).toContain('reason: "not_checked_in"');
  });

  it("requires explicit consent", () => {
    expect(resolver).toContain("hasEventLinkrConsent(");
    expect(resolver).toContain('reason: "no_consent"');
  });

  it("fails closed with a reason rather than a blank screen", () => {
    expect(resolver).toContain('reason: "event_not_found"');
  });
});

describe("Event Mode is gated on consent, not just presence", () => {
  it("checks eligibility before granting Event context", () => {
    /* The regression this guards: check-in alone used to be sufficient, which
     * put anybody who arrived into stranger discovery without asking. */
    /* The CALL, not the name. "resolveEventLinkrEligibility" also appears as a
     * type field and a typeof guard, so a bare-name match passed even when the
     * real invocation was replaced by a hardcoded `eligible: true`. */
    expect(modeAdapter).toContain("await mod.resolveEventLinkrEligibility(admin, userId, eventId)");
    // Fails closed when the Events consent module cannot be reached at all.
    expect(modeAdapter).toContain('return { eligible: false, reason: "consent_module_unavailable" };');
    expect(linkrPage).toContain("resolveViewerEventMode(");
  });

  it("still re-checks the URL server-side", () => {
    /* The query parameter is a request, never an authorisation. /discover is
     * now only a redirect, so the re-check lives on the page that actually
     * renders Linkr -- and the id is validated before it is ever used. */
    expect(discover).toContain("redirect");
    expect(linkrPage).toContain("UUID_PATTERN.test(params.eventId)");
    expect(linkrPage).toContain("resolveViewerEventMode(admin, user.id, requestedEventId)");
  });
});

describe("candidates are a set to intersect, not a directory", () => {
  const candidates = consent.slice(consent.indexOf("export async function eventLinkrCandidateIds"));

  it("returns ids only", () => {
    expect(candidates).toContain("Promise<Set<string>>");
    expect(candidates).not.toContain("full_name");
    expect(candidates).not.toContain("avatar_url");
  });

  it("requires consent AND presence", () => {
    expect(candidates).toContain('.eq("enabled", true)');
    expect(candidates).toContain('.eq("status", "checked_in")');
  });

  it("excludes the viewer from their own pool", () => {
    expect(candidates).toContain("id !== viewerId");
  });

  it("batches rather than querying per candidate", () => {
    expect(candidates).toContain('.in("user_id", consentingIds)');
  });
});

describe("a small pool is not a headcount", () => {
  it("hides an exact count that would describe individuals", () => {
    // "3 people are open to connecting" at a small Event is close to naming
    // them.
    expect(describeEventLinkrPool(1)).toBe("People here are open to connecting.");
    expect(describeEventLinkrPool(EVENT_LINKR_COUNT_THRESHOLD - 1)).toBe(
      "People here are open to connecting."
    );
  });

  it("shows a number once it is genuinely a crowd", () => {
    expect(describeEventLinkrPool(EVENT_LINKR_COUNT_THRESHOLD)).toContain(
      String(EVENT_LINKR_COUNT_THRESHOLD)
    );
  });

  it("says nothing at all when nobody is there", () => {
    expect(describeEventLinkrPool(0)).toBeNull();
  });
});

describe("the consent sheet asks rather than assumes", () => {
  it("states the location promise explicitly", () => {
    expect(sheet).toContain("Your exact location is never shown.");
  });

  it("says discovery is mutual", () => {
    // Reworded in 4H when the sheet split into first-consent and opted-in
    // states. The promise that must survive is mutuality, not the sentence.
    expect(sheet).toContain("Only people who choose this can discover one another here.");
  });

  it("offers a way out as well as in", () => {
    expect(sheet).toContain("Not now");
    expect(sheet).toContain("Turn off");
  });

  it("does not paint success on a server refusal", () => {
    const decide = sheet.slice(sheet.indexOf("function decide"));
    expect(decide).toContain("if (!result.ok)");
    expect(decide.indexOf("if (!result.ok)")).toBeLessThan(decide.indexOf("onConsentChange("));
  });
});
