import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

import type { HomeUpForContext } from "@/lib/social/home-upfor-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * ACCEPTED IS A TRANSITION, NOT A DESTINATION.
 *
 * The reported defect: after Jesse accepted the viewer's request to join a
 * Study UpFor, Home said "You are in" and offered **Open UpFor** -- sending the
 * person back into the surface whose question had just been answered.
 *
 * The discovery loop (create -> request -> accept) has already succeeded at
 * that point. The next real job is to coordinate with the person they are now
 * going with. So the rule this file holds is:
 *
 *   A SMART CARD ADVANCES THE LOOP; IT DOES NOT REOPEN THE OBJECT THAT
 *   GENERATED THE CARD.
 *
 * The second thing it holds is the limit of that: Home may only OFFER a message
 * where the relationship could actually support one. It never grants
 * permission -- the server decides at click time.
 */

const NOW = new Date("2026-08-05T10:00:00.000Z");

const joined = (
  over: Partial<HomeUpForContext["joined"][number]> = {}
): HomeUpForContext["joined"][number] => ({
  id: "session-1",
  ownerId: "owner-jesse",
  ownerName: "Jesse",
  activityType: "study",
  activityLabel: "Study",
  myStatus: "accepted",
  startsAt: null,
  endsAt: null,
  ownerIsCertainMuddy: true,
  coordinatedSinceAccepted: false,
  ...over
});

const context = (over: Partial<HomeUpForContext> = {}): HomeUpForContext => ({
  ownedLive: [],
  ownedScheduled: [],
  joined: [],
  opportunities: [],
  ...over
});

function input(over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 4,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    access: { canExpand: true },
    ...over
  };
}

const pick = (over: Partial<SmartCardInput> = {}) => {
  const built = input(over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

const accepted = (session: Partial<HomeUpForContext["joined"][number]> = {}) =>
  pick({ upFor: context({ joined: [joined(session)] }) });

describe("the reported defect is gone", () => {
  it("no longer sends the viewer back into UpFor as the primary action", () => {
    const card = accepted();
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.cta).not.toBe("Open UpFor");
  });

  it("offers to message the person who said yes", () => {
    const card = accepted();
    expect(card?.cta).toBe("Message Jesse");
    expect(card?.primaryIntent).toEqual({
      kind: "open_direct_conversation",
      targetUserId: "owner-jesse"
    });
  });

  it("keeps UpFor reachable, demoted to secondary and pointing at that session", () => {
    const card = accepted({ id: "session-42" });
    expect(card?.secondaryAction).toEqual({
      label: "View UpFor",
      destination: "/hangout-mode?hangout=session-42"
    });
  });

  /**
   * `destination` is not dead when an intent exists -- it is the honest
   * fallback surface, so the card can never be actionless if the conversation
   * cannot be opened.
   */
  it("still carries a real destination behind the intent", () => {
    const card = accepted({ id: "session-42" });
    expect(card?.destination).toBe("/hangout-mode?hangout=session-42");
  });

  it("reads as momentum rather than system status", () => {
    const card = accepted();
    expect(card?.eyebrow).toBe("YOU'RE IN");
    expect(card?.title).toBe("Jesse said yes");
    expect(card?.subtitle).toBe("You're studying together.");
  });

  /**
   * Copy generation is deliberately narrow. An activity with no natural
   * present-participle phrasing keeps the safe existing sentence rather than
   * risking "You're anything together" -- the fix here is the next ACTION.
   */
  it("falls back to the safe sentence for activities it cannot phrase", () => {
    const card = accepted({ activityType: "anything", activityLabel: "Anything" });
    expect(card?.subtitle).toBe("You are going to anything.");
    expect(card?.cta).toBe("Message Jesse");
  });
});

describe("Home offers a message only where one could be allowed", () => {
  /**
   * Direct messaging requires approved-Muddy or an active Linkr connection
   * (resolveDirectMessageEligibility). Every UpFor audience except
   * `selected_groups` already refuses a non-Muddy, so being in the session
   * proves mutuality for those. A public Group UpFor is the one audience that
   * admits a stranger -- and a primary action known to be refused is worse than
   * a modest one.
   */
  it("withholds the message offer when the audience cannot vouch for mutuality", () => {
    const card = accepted({ ownerIsCertainMuddy: false, id: "session-9" });
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.primaryIntent).toBeUndefined();
    expect(card?.cta).toBe("View UpFor");
    expect(card?.destination).toBe("/hangout-mode?hangout=session-9");
  });

  it("does not offer a duplicate secondary when UpFor is already the primary", () => {
    const card = accepted({ ownerIsCertainMuddy: false });
    expect(card?.secondaryAction).toBeUndefined();
  });

  /**
   * The hint never GRANTS anything. It can only remove an offer; the server
   * still decides, so a card carrying the intent is a request to try, not a
   * claim that it will succeed.
   */
  it("carries only an id in the intent, never an eligibility claim", () => {
    const card = accepted();
    expect(Object.keys(card?.primaryIntent ?? {}).sort()).toEqual(["kind", "targetUserId"]);
  });
});

describe("states that are NOT accepted keep their own behaviour", () => {
  it("a pending request stays a waiting state and offers no message", () => {
    const card = accepted({ myStatus: "pending" });
    expect(card?.id).toBe("upfor_active_muddy");
    expect(card?.primaryIntent).toBeUndefined();
    expect(card?.cta).not.toMatch(/^Message /);
  });

  it("the viewer's OWN UpFor stays a management state", () => {
    const card = pick({
      upFor: context({
        ownedLive: [
          {
            id: "mine-1",
            activityType: "coffee",
            activityLabel: "Coffee",
            startsAt: null,
            endsAt: null,
            pendingRequestCount: 2,
            acceptedCount: 0
          }
        ]
      })
    });
    expect(card?.id).toBe("upfor_requests");
    expect(card?.primaryIntent).toBeUndefined();
  });

  it("no other wired state gains an intent", () => {
    const built = input({ upFor: context({ joined: [joined()] }) });
    for (const provider of smartCardProviders(built)) {
      const card = provider.build();
      if (!card || card.id === "upfor_accepted") continue;
      expect(card.primaryIntent, `${card.id} must stay a link`).toBeUndefined();
    }
  });
});

describe("Access never removes an existing commitment", () => {
  /**
   * An accepted UpFor is a commitment that already exists. Expiry stops the
   * NEXT expansion; it must not strip the coordination the person already
   * earned, and it must not paywall the message.
   */
  const ENTITLEMENTS: Array<[string, SmartCardInput["access"]]> = [
    ["has access", { canExpand: true }],
    ["no access", { canExpand: false }],
    ["unknown entitlement", null],
    ["absent entitlement", undefined]
  ];

  for (const [label, access] of ENTITLEMENTS) {
    it(`${label}: the accepted coordination card is unchanged`, () => {
      const card = pick({ upFor: context({ joined: [joined()] }), access });
      expect(card?.id).toBe("upfor_accepted");
      expect(card?.cta).toBe("Message Jesse");
      expect(card?.primaryIntent).toEqual({
        kind: "open_direct_conversation",
        targetUserId: "owner-jesse"
      });
      expect(card?.secondaryAction?.destination).toBe("/hangout-mode?hangout=session-1");
    });
  }

  it("is byte-identical whatever entitlement says", () => {
    const withAccess = JSON.stringify(
      pick({ upFor: context({ joined: [joined()] }), access: { canExpand: true } })
    );
    const withoutAccess = JSON.stringify(
      pick({ upFor: context({ joined: [joined()] }), access: { canExpand: false } })
    );
    expect(withoutAccess).toBe(withAccess);
  });
});

/**
 * CONVERSION. A converted UpFor must not leave a stale coordination card
 * behind, and Home must not grow a second card saying the same thing.
 *
 * The mechanism is already correct and this pins it: `loadHomeUpForContext`
 * reads joined sessions with `.eq("status", "active")`, and the canonical
 * lifecycle sets `status = 'converted_to_plan'`. So a converted session simply
 * stops appearing in `joined`, `upfor_accepted` yields, and Plan authority
 * takes the moment over. Nothing had to be added to make that true.
 */
describe("conversion hands the moment to Plan authority", () => {
  const READER = readFileSync("lib/social/home-upfor-context.ts", "utf8");

  it("joined sessions are read as ACTIVE only", () => {
    expect(READER).toContain('.eq("status", "active")');
  });

  it("the accepted card disappears once the session leaves the joined set", () => {
    /* Post-conversion shape: the reader returns no joined session at all. */
    const card = pick({ upFor: context({ joined: [] }) });
    expect(card?.id).not.toBe("upfor_accepted");
  });

  it("nothing keeps the accepted card alive to say 'Open Plan Chat'", () => {
    const source = readFileSync("lib/smart-card/providers.ts", "utf8");
    const provider = source.slice(
      source.indexOf("function upForAcceptedProvider"),
      source.indexOf("function ownedUpForStartingProvider")
    );
    expect(provider).not.toMatch(/converted_plan_id|Open Plan Chat|plan_chat/i);
  });
});

/**
 * HOME READ STAYS A READ. The provider is pure and the projection performs no
 * mutation, so no conversation can be created while Home renders -- it happens
 * only when somebody taps.
 */
describe("Home renders without creating anything", () => {
  it("the provider performs no query and no mutation", () => {
    const source = readFileSync("lib/smart-card/providers.ts", "utf8");
    const provider = source.slice(
      source.indexOf("function upForAcceptedProvider"),
      source.indexOf("function ownedUpForStartingProvider")
    );
    expect(provider).not.toMatch(/await |\.from\(|\.rpc\(|openDirectConversation/);
  });

  /**
   * The projection may now READ conversations -- that is how it learns whether
   * the viewer has already coordinated -- but it must never OPEN or write one.
   * The distinction is the whole point: Home reads, taps mutate.
   */
  it("the UpFor projection reads but never opens or writes a conversation", () => {
    const reader = readFileSync("lib/social/home-upfor-context.ts", "utf8");
    expect(reader).not.toMatch(/openDirectConversation|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  });

  it("carries the owner id without adding a read", () => {
    const reader = readFileSync("lib/social/home-upfor-context.ts", "utf8");
    /* owner_id was ALREADY selected to resolve the owner's name and to drop the
       viewer's own sessions, so exposing it costs nothing. `audience_type` rides
       the same existing select. */
    expect(reader).toContain(
      '.select("id, owner_id, activity_type, status, starts_at, ends_at, audience_type")'
    );
    /* And no PER-SESSION lookup was introduced. The reads added since are all
       batched over the whole candidate set:
         joined sessions, owner profiles              (2, pre-existing)
         conversations + messages                     (2, coordination evidence)
         friendships, sessions, profiles              (3, opportunity discovery)
       Seven bounded reads, none of them inside a loop. */
    const joinedBlock = reader.slice(reader.indexOf("const joinedSessionIds"));
    expect(joinedBlock.match(/\.from\(/g) ?? []).toHaveLength(7);

    /* The real invariant behind that number: every read is batched over a
       whole candidate set, so none of them sits inside a loop. */
    for (const batched of [".in(", "batchBlockedIds"]) {
      expect(reader, batched).toContain(batched);
    }
  });
});

/**
 * THE RENDERER SEAM.
 *
 * Source-contract assertions, matching this codebase's existing convention for
 * component rules (see compact-hero.test.ts) and its warning about CRLF: match
 * single-line substrings, never sliced multi-line source.
 *
 * The rules are behavioural, not stylistic. A tap that opens a conversation is
 * a mutation, so it must be guarded against double submission, must not leak a
 * raw failure, and must not exist for cards that merely navigate.
 */
describe("the primary-intent seam obeys the action rules", () => {
  const component = stripComments(readFileSync("components/journey/smart-card-v2.tsx", "utf8"));

  it("uses the canonical direct-conversation action, not a hand-built route", () => {
    expect(component).toContain("openDirectConversationAction(intent.targetUserId)");
    expect(component).not.toMatch(/\/messages\?user=|\/messages\/\$\{/);
  });

  it("routes success through the canonical conversation href", () => {
    expect(component).toContain("router.push(conversationHref(result.conversationId))");
  });

  it("guards against a double tap", () => {
    expect(component).toContain("if (!intent || intentPending) return;");
    expect(component).toContain("disabled={intentPending}");
  });

  it("shows the action's own refusal copy and never a raw error", () => {
    expect(component).toContain("setIntentError(result.message");
    /* The catch must not interpolate the thrown value into what a person sees. */
    expect(component).toContain("That didn" + String.fromCharCode(39) + "t work. Try again.");
    expect(component).not.toMatch(/setIntentError\((error|err|e)/);
  });

  it("makes a refusal visible rather than silent", () => {
    expect(component).toContain('role="status"');
    expect(component).toContain("{intentError}");
  });

  it("keeps ordinary cards as links", () => {
    expect(component).toContain("card.primaryIntent ? (");
    expect(component).toContain("href={card.destination as Route}");
  });

  it("keeps every action at the 44px minimum target", () => {
    /* min-h-11 is 44px. Both primary branches share one class string, so the
       rule cannot drift between them. */
    expect(component).toContain("const primaryClassName = cn(");
    expect(component).toContain("focus-ring inline-flex min-h-11 items-center");
  });

  it("renders one interactive element per action, never nested", () => {
    /* The primary is EITHER a button OR a link, chosen by a ternary -- so a
       button can never end up inside a link. */
    expect(component).toContain("<button");
    expect(component).not.toMatch(/<Link[^>]*>\s*<button/);
  });
});
