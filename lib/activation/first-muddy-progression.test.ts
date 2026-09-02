import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  FIRST_MUDDY_ACKNOWLEDGEMENT_MS,
  hasCompletedFirstSocialAct,
  shouldAcknowledgeFirstMuddy
} from "@/lib/activation/state";

/**
 * BETA-011. "Say hi" would not let go.
 *
 * A beta tester on a real phone signed up, added their first Muddy, was
 * congratulated, tapped "Say hi", opened the real conversation, typed a real
 * message, sent it, went back to Home -- and Home asked them to say hi again.
 * They were stuck on a step they had already completed.
 *
 * There were two independent causes, and fixing either alone still leaves a
 * broken product, so both are held here:
 *
 *   1. `shouldAcknowledgeFirstMuddy` judged the card purely by how recently
 *      the first Muddy arrived. For six hours it re-issued an instruction
 *      regardless of whether the instruction had been carried out.
 *   2. Nothing invalidated Home after a send. Home is a server component on
 *      another route, so the Client Router Cache replayed a stale payload on
 *      back-navigation: a hard refresh advanced, an ordinary back-tap did not.
 *
 * These are BEHAVIOURAL assertions where behaviour can be tested. The
 * revalidation one cannot be observed without a browser, so it is pinned at
 * the source boundary where the guarantee actually lives.
 */

const MUDDY_JUST_NOW = Date.UTC(2026, 8, 2, 20, 0, 0);
const NOW = MUDDY_JUST_NOW + 5 * 60 * 1000; // five minutes later: well inside the window

const base = {
  muddyCount: 1,
  firstMuddyReachedAtMs: MUDDY_JUST_NOW,
  nowMs: NOW
};

describe("A1 — the acknowledgement retires when the social act completes", () => {
  it("asks for Say hi while nothing social has happened yet", () => {
    expect(shouldAcknowledgeFirstMuddy({ ...base, milestones: new Set(["first_muddy_added"]) })).toBe(
      true
    );
  });

  it("STOPS asking once a real message has been sent", () => {
    /* THE DEFECT, stated as behaviour. Same instant, same fresh Muddy -- the
     * only thing that changed is that the person did what they were asked. */
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        milestones: new Set(["first_muddy_added", "first_message_sent"])
      })
    ).toBe(false);
  });

  it("stops asking after a Wave, which is the same act by another route", () => {
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        milestones: new Set(["first_muddy_added", "first_wave_sent"])
      })
    ).toBe(false);
  });

  it("stops asking after a Plan is created", () => {
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        milestones: new Set(["first_muddy_added", "first_plan_created"])
      })
    ).toBe(false);
  });

  it("does NOT count a broadcast status as saying hi to this person", () => {
    /* A status is expression, not reaching out to the Muddy this card names.
     * `hasReachedFirstValue` counts it for account-level activation; dismissing
     * a nudge to speak to somebody is a narrower question and must not. */
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        milestones: new Set(["first_muddy_added", "first_status_created"])
      })
    ).toBe(true);
  });
});

describe("A3 — the completion persists, because it is derived from the account", () => {
  it("stays completed at any later time, not just within the window", () => {
    /* Reload, relogin, another device: all read the same milestone rows, so
     * there is no local flag that a refresh could resurrect. */
    const muchLater = MUDDY_JUST_NOW + 5 * 60 * 1000;
    const milestones = new Set(["first_muddy_added", "first_message_sent"]);
    expect(shouldAcknowledgeFirstMuddy({ ...base, nowMs: muchLater, milestones })).toBe(false);
    expect(
      shouldAcknowledgeFirstMuddy({ ...base, nowMs: MUDDY_JUST_NOW + 1000, milestones })
    ).toBe(false);
  });

  it("still fades on time alone for somebody who never acted", () => {
    /* The original behaviour is preserved, not replaced: an account that added
     * a Muddy and did nothing sees ordinary Home tomorrow. */
    const stale = MUDDY_JUST_NOW + FIRST_MUDDY_ACKNOWLEDGEMENT_MS + 1;
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        nowMs: stale,
        milestones: new Set(["first_muddy_added"])
      })
    ).toBe(false);
  });
});

describe("A5 — existing accounts are not regressed", () => {
  it("never acknowledges an account with no Muddy", () => {
    expect(
      shouldAcknowledgeFirstMuddy({ ...base, muddyCount: 0, milestones: new Set(["first_muddy_added"]) })
    ).toBe(false);
  });

  it("never acknowledges when the milestone has no timestamp", () => {
    expect(
      shouldAcknowledgeFirstMuddy({ ...base, firstMuddyReachedAtMs: null, milestones: new Set() })
    ).toBe(false);
  });

  it("keeps its exact previous behaviour when milestones are not supplied", () => {
    /* The parameter is optional so every existing caller is untouched. */
    expect(shouldAcknowledgeFirstMuddy(base)).toBe(true);
    expect(
      shouldAcknowledgeFirstMuddy({
        ...base,
        nowMs: MUDDY_JUST_NOW + FIRST_MUDDY_ACKNOWLEDGEMENT_MS + 1
      })
    ).toBe(false);
  });
});

describe("the social-act predicate is narrower than first value", () => {
  it("is true for each act directed at another person", () => {
    expect(hasCompletedFirstSocialAct(new Set(["first_message_sent"]))).toBe(true);
    expect(hasCompletedFirstSocialAct(new Set(["first_wave_sent"]))).toBe(true);
    expect(hasCompletedFirstSocialAct(new Set(["first_plan_created"]))).toBe(true);
  });

  it("is false for setup and for broadcast", () => {
    expect(hasCompletedFirstSocialAct(new Set())).toBe(false);
    expect(hasCompletedFirstSocialAct(new Set(["first_muddy_added"]))).toBe(false);
    expect(hasCompletedFirstSocialAct(new Set(["first_status_created"]))).toBe(false);
    expect(hasCompletedFirstSocialAct(new Set(["profile_completed"]))).toBe(false);
  });
});

describe("A2 — Home is invalidated after a real send", () => {
  const actions = stripComments(readFileSync("app/(app)/messaging-actions.ts", "utf8"));

  it("revalidates the Home route from the send action", () => {
    /* Without this the projection is correct and the SCREEN is stale: back
     * navigation replays a cached RSC payload, so only a hard refresh advanced
     * Home. Fixing the milestone alone would have left the bug on the phone. */
    expect(actions).toContain('revalidatePath("/dashboard")');
  });

  it("A4 — revalidates ONLY when the send actually succeeded", () => {
    /* A rejected, blocked, rate-limited or failed send must not move the
     * journey. The optimistic bubble is not evidence; the persisted row is. */
    expect(actions).toContain('if (result.ok) revalidatePath("/dashboard")');
  });

  it("does not invalidate the messaging surfaces themselves", () => {
    /* They refresh through realtime and refreshThread. Invalidating them would
     * discard warm thread state and re-pay the open-chat latency that the
     * messaging work deliberately removed. */
    expect(actions).not.toContain('revalidatePath("/messages")');
  });
});

describe("the projection asks the completion question", () => {
  const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

  it("passes milestones into the acknowledgement decision", () => {
    const call = projection.slice(
      projection.indexOf("shouldAcknowledgeFirstMuddy({"),
      projection.indexOf("shouldAcknowledgeFirstMuddy({") + 400
    );
    expect(call).toContain("milestones");
  });
});

describe("Say hi still only opens the door", () => {
  const card = stripComments(readFileSync("components/activation/first-muddy-card.tsx", "utf8"));
  const dashboard = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));

  it("never auto-sends a greeting on the user's behalf", () => {
    expect(card).not.toContain("sendMessageAction");
    expect(card).not.toMatch(/sendMessage\s*\(/);
  });

  it("routes Say hi through the canonical open-conversation action", () => {
    expect(dashboard).toContain('runRelationshipAction("say_hi", muddyId)');
  });
});
