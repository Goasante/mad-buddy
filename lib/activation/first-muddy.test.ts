import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  FIRST_MUDDY_ACKNOWLEDGEMENT_MS,
  shouldAcknowledgeFirstMuddy
} from "@/lib/activation/state";

/**
 * The first Muddy is a moment, not a database row.
 *
 * It is acknowledged once, warmly, and then it stops -- without a "have we
 * shown this" flag, because milestone recency already answers the question.
 */

const NOW = Date.UTC(2026, 7, 15, 20, 0, 0);
const ago = (ms: number) => NOW - ms;

describe("acknowledging the first Muddy", () => {
  it("acknowledges a connection that just happened", () => {
    expect(
      shouldAcknowledgeFirstMuddy({ muddyCount: 1, firstMuddyReachedAtMs: ago(60_000), nowMs: NOW })
    ).toBe(true);
  });

  it("still acknowledges within the window, so closing the app does not lose it", () => {
    expect(
      shouldAcknowledgeFirstMuddy({
        muddyCount: 1,
        firstMuddyReachedAtMs: ago(FIRST_MUDDY_ACKNOWLEDGEMENT_MS - 60_000),
        nowMs: NOW
      })
    ).toBe(true);
  });

  it("stops once the news is no longer news", () => {
    // Returning tomorrow gets an ordinary Home, not a repeat congratulation.
    expect(
      shouldAcknowledgeFirstMuddy({
        muddyCount: 1,
        firstMuddyReachedAtMs: ago(FIRST_MUDDY_ACKNOWLEDGEMENT_MS + 60_000),
        nowMs: NOW
      })
    ).toBe(false);
  });

  it("does not replay for somebody who connected long ago", () => {
    const aWeek = 7 * 24 * 60 * 60 * 1000;
    expect(
      shouldAcknowledgeFirstMuddy({ muddyCount: 6, firstMuddyReachedAtMs: ago(aWeek), nowMs: NOW })
    ).toBe(false);
  });

  it("says nothing when there is no Muddy to acknowledge", () => {
    expect(
      shouldAcknowledgeFirstMuddy({ muddyCount: 0, firstMuddyReachedAtMs: ago(60_000), nowMs: NOW })
    ).toBe(false);
  });

  it("says nothing when the milestone was never recorded", () => {
    expect(
      shouldAcknowledgeFirstMuddy({ muddyCount: 1, firstMuddyReachedAtMs: null, nowMs: NOW })
    ).toBe(false);
  });

  it("treats clock skew as just-happened rather than hiding the moment", () => {
    // A server slightly ahead of the client must not swallow something earned.
    expect(
      shouldAcknowledgeFirstMuddy({ muddyCount: 1, firstMuddyReachedAtMs: NOW + 5_000, nowMs: NOW })
    ).toBe(true);
  });

  it("needs no stored 'already shown' flag", () => {
    // Recency IS the answer, which is why this needed no migration.
    const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));
    expect(projection).toContain("reached_at");
    expect(projection).not.toContain("acknowledged_at");
    expect(projection).not.toContain("onboarding_step");
  });
});

describe("Glow is the hero, not a map pin", () => {
  const card = stripComments(readFileSync("components/activation/first-muddy-card.tsx", "utf8"));

  it("leads with the person in the app's real Glow treatment", () => {
    /* Matches the element boundary, not a prefix.
     *
     * `toContain("<GlowAvatar")` also matched `<GlowAvatarX`, so swapping in a
     * different component passed. The trailing boundary is what makes this
     * assert the real component rather than anything starting with its name. */
    expect(card).toMatch(/<GlowAvatar[\s/>]/);
    // And it must be the Glow treatment doing the work, with a real signal.
    expect(card).toContain("proximityLevel=");
    expect(card).toContain("glowStrength=");
  });

  it("reuses the canonical Glow component rather than a second implementation", () => {
    expect(card).toContain('from "@/components/glow/glow-avatar"');
  });

  it("uses no map, pin, radar or distance metaphor", () => {
    for (const forbidden of ["MapPin", "Radar", "Map", "km", "metres", "coordinates"]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("passes reduced motion through to the Glow treatment", () => {
    expect(card).toContain("useReducedMotion");
    expect(card).toContain("reducedMotion={reducedMotion}");
  });

  it("never fabricates an avatar", () => {
    // GlowAvatar owns the no-photo fallback; nothing invents an image here.
    expect(card).toContain("src={muddy.avatarUrl}");
    expect(card).not.toContain("placeholder.");
  });
});

describe("the capability is offered, never taken", () => {
  const card = stripComments(readFileSync("components/activation/first-muddy-card.tsx", "utf8"));

  it("names the Mad Buddy capability, not the OS mechanism", () => {
    expect(card).toContain("Turn on Glow");
    expect(card).not.toContain("Turn on location");
  });

  it("avoids the ambiguous area wording", () => {
    /* The promise must be PRESENT, not in one exact sentence.
     *
     * It used to appear twice -- once in the paragraph, once in the guarantee
     * below -- which read as the app reassuring itself, so the paragraph
     * dropped it. Pinning that removed sentence failed while the rule it
     * protects was intact. */
    expect(card).not.toContain("see your area");
    expect(card).toMatch(/exact location/);
  });

  it("uses none of the surveillance vocabulary", () => {
    /* Checks the COPY, not the class names.
     *
     * A plain substring scan flagged "tracking-tight" -- a Tailwind letter
     * -spacing utility -- as the word "track". Banning it there would force the
     * component to avoid a standard typography class to satisfy a copy rule,
     * which is the test dictating implementation. Whole words in visible
     * strings are what the rule is actually about. */
    // Sentences only: lines of prose, not imports or class attributes.
    const copy = card
      .split("\n")
      .filter((line) => !line.includes("import ") && !line.includes("className"))
      .join(" ");
    for (const banned of [/\btrack\w*/i, /\bmonitor\w*/i, /\bwatching\b/i, /live location/i]) {
      expect(copy).not.toMatch(banned);
    }
  });

  it("fires no permission prompt on render", () => {
    // The OS prompt belongs to the existing settings flow, behind a real tap.
    expect(card).not.toContain("geolocation");
    expect(card).not.toContain("getCurrentPosition");
    expect(card).not.toContain("useEffect");
  });

  it("offers one primary action", () => {
    /* ONE VISIBLE, not one in the file (MB-GOD-050).
     *
     * The card now has two CTAs, and they are MUTUALLY EXCLUSIVE: while Glow
     * is off, "Turn on Glow" is the honest next step; once it is on, "Say hi"
     * is, because the product's own first-value definition needs a social act
     * after `first_muddy_added` and this card previously offered nothing at
     * all in that state.
     *
     * Counting `<Button` in the source cannot tell an exclusive branch from
     * two competing buttons, so the assertion moved to the structure that
     * makes them exclusive. If anyone renders them side by side, the
     * `needsLocation ? … : onSayHi ? …` chain disappears and this fails. */
    const buttons = card.split("<Button").length - 1;
    expect(buttons, "more CTAs than the two exclusive states").toBe(2);
    expect(card, "the two CTAs must be branches of ONE conditional").toMatch(
      /needsLocation \? \([\s\S]*?\) : onSayHi \? \(/
    );
    // And neither may sit outside that conditional as a third, always-on CTA.
    const afterChain = card.slice(card.indexOf(") : onSayHi ? ("));
    expect(afterChain.split("<Button").length - 1, "a CTA outside the exclusive chain").toBe(1);
  });

  it("Say hi goes through Home's canonical conversation path", () => {
    /* The card must not grow its own route to a conversation. Home already
       owns `runRelationshipAction`, which calls openDirectConversationAction
       and then conversationHref -- the same entry New Message uses. */
    const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
    expect(home).toContain('onSayHi={(muddyId) => runRelationshipAction("say_hi", muddyId)}');
    expect(card, "the card must not open a conversation itself").not.toContain(
      "openDirectConversationAction"
    );
    expect(card, "the card must not build a conversation URL itself").not.toContain("/messages");
  });

  it("states each guarantee in words, not icon alone", () => {
    expect(card).toContain("Only approved Muddies");
    expect(card).toContain("Never your exact location");
    expect(card).toContain("You stay in control");
  });
});

describe("Home shows one activation voice at a time", () => {
  const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

  it("replaces the generic card while acknowledging the first Muddy", () => {
    // Two cards asking for the same thing is the app repeating itself at the
    // exact moment it should be warm.
    expect(home).toContain("{firstMuddy ? (");
    expect(home).toContain(") : activationState ? (");
  });

  it("derives the acknowledgement on the server", () => {
    const route = stripComments(readFileSync("app/(app)/dashboard/page.tsx", "utf8"));
    expect(route).toContain("activation?.acknowledgeFirstMuddy");
  });

  it("keeps it above every other Home surface", () => {
    const at = home.indexOf("<FirstMuddyCard");
    for (const later of ["<SmartCardHero", "<NearbyHero", "<TopEventsHome"]) {
      expect(at).toBeLessThan(home.indexOf(later));
    }
  });
});
