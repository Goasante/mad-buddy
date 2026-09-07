import { describe, expect, it } from "vitest";

import type { HomeUpForContext } from "@/lib/social/home-upfor-context";
import { smartCardProviders, type SmartCardInput } from "@/lib/smart-card/providers";
import { resolveSmartCard } from "@/lib/smart-card/smart-card";

/**
 * THE WHOLE UPFOR LIFECYCLE, AS HOME SEES IT.
 *
 *   a Muddy puts something out   -> upfor_opportunity   "See UpFor"
 *   the viewer asks to join      -> upfor_active_muddy  "Details"
 *   the owner says yes           -> upfor_accepted      "Message <owner>"
 *   the viewer actually writes   -> the job is DONE, and something else wins
 *
 * Two real-phone defects live in that sequence, and both were the same mistake
 * in different places: confusing a STATE with a JOB.
 *
 *   Discovery was missing entirely. `upfor_active_muddy` only ever looked at
 *   sessions the viewer had ALREADY requested, so the moment somebody put an
 *   UpFor out -- the moment the card exists for -- Home said nothing.
 *
 *   Coordination never finished. `myStatus === "accepted"` stays true for the
 *   life of the session, so Home kept saying "Message Kofi" to somebody who had
 *   just messaged Kofi.
 *
 * The invariant these tests exist to hold: HOME MUST NOT KEEP RECOMMENDING A
 * JOB THE PERSON HAS ALREADY DONE.
 */

const NOW = new Date("2026-09-07T18:00:00.000Z");

const opportunity = (
  over: Partial<HomeUpForContext["opportunities"][number]> = {}
): HomeUpForContext["opportunities"][number] => ({
  id: "session-kojo",
  ownerId: "owner-kojo",
  ownerName: "Kojo",
  activityType: "gym",
  activityLabel: "Gym",
  endsAt: new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString(),
  ...over
});

const joined = (
  over: Partial<HomeUpForContext["joined"][number]> = {}
): HomeUpForContext["joined"][number] => ({
  id: "session-ama",
  ownerId: "owner-ama",
  ownerName: "Ama",
  activityType: "coffee",
  activityLabel: "Coffee",
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

function input(upFor: HomeUpForContext, over: Partial<SmartCardInput> = {}): SmartCardInput {
  return {
    now: NOW,
    journey: { completedCount: 8, totalCount: 8, currentStep: null, steps: [] },
    safeArrival: null,
    birthday: null,
    agenda: [],
    weekendPlanCount: 0,
    nearbyFriends: [],
    locationFreshForProximity: false,
    muddyCount: 5,
    buddyScore: null,
    recentAchievement: null,
    suggestionCount: 0,
    access: { canExpand: true },
    upFor,
    ...over
  };
}

const pick = (upFor: HomeUpForContext, over: Partial<SmartCardInput> = {}) => {
  const built = input(upFor, over);
  return resolveSmartCard(smartCardProviders(built), {
    now: built.now.getTime(),
    acknowledgedIds: new Set(["journey_complete"])
  });
};

describe("1. a Muddy puts something out, before the viewer has acted", () => {
  it("surfaces the grounded opportunity", () => {
    const card = pick(context({ opportunities: [opportunity()] }));
    expect(card?.id).toBe("upfor_opportunity");
    expect(card?.title).toBe("Kojo is UpFor gym");
    expect(card?.cta).toBe("See UpFor");
    expect(card?.destination).toBe("/hangout-mode?hangout=session-kojo");
  });

  it("counts a crowd without listing it", () => {
    const card = pick(
      context({
        opportunities: [opportunity(), opportunity({ id: "s2", ownerId: "o2", ownerName: "Ama" })]
      })
    );
    expect(card?.subtitle).toBe("2 of your Muddies are UpFor something right now.");
    expect(card?.subtitle).not.toContain("Ama");
  });

  /**
   * The reader excludes sessions the viewer already requested, so an empty list
   * is the only shape a pure provider can be asked about. A session the viewer
   * cannot see never reaches here either -- it is filtered by audience, block
   * and lifecycle before the projection is built.
   */
  it("says nothing when there is no eligible opportunity", () => {
    expect(pick(context({ opportunities: [] }))?.id).not.toBe("upfor_opportunity");
  });
});

describe("2. the viewer asks to join", () => {
  it("advances to the waiting state rather than repeating the invitation", () => {
    const card = pick(
      context({ joined: [joined({ id: "session-kojo", ownerName: "Kojo", myStatus: "pending" })] })
    );
    expect(card?.id).toBe("upfor_active_muddy");
    expect(card?.meta).toBe("Waiting on them");
    expect(card?.cta).not.toBe("See UpFor");
  });

  /**
   * THE DEFECT THIS PREVENTS. The reader removes a requested session from the
   * opportunity list, so Home cannot go on saying "Kojo is UpFor gym" as though
   * the viewer had done nothing about it.
   */
  it("does not also present it as an untouched opportunity", () => {
    const card = pick(
      context({
        joined: [joined({ id: "session-kojo", ownerName: "Kojo", myStatus: "pending" })],
        opportunities: []
      })
    );
    expect(card?.id).not.toBe("upfor_opportunity");
  });
});

describe("3. the owner says yes", () => {
  it("advances to coordination", () => {
    const card = pick(context({ joined: [joined()] }));
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.title).toBe("Ama said yes");
    expect(card?.cta).toBe("Message Ama");
  });

  /**
   * Opening the conversation is NOT completion. The card is built from the
   * projection's evidence flag, and a conversation merely existing never sets
   * it -- only a real message after acceptance does.
   */
  it("still offers the message when the chat was opened but nothing was sent", () => {
    const card = pick(context({ joined: [joined({ coordinatedSinceAccepted: false })] }));
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.cta).toBe("Message Ama");
  });
});

describe("4. the viewer actually writes -- the job is done", () => {
  /**
   * THE MANDATORY ASSERTION. Home must not tell somebody to message a person
   * they have just messaged about this acceptance.
   */
  it("retires the coordination card once a real message exists", () => {
    const card = pick(context({ joined: [joined({ coordinatedSinceAccepted: true })] }));
    expect(card?.id).not.toBe("upfor_accepted");
    expect(JSON.stringify(card)).not.toContain("Message Ama");
  });

  it("stays retired even though the request is still accepted", () => {
    /* The state has not changed -- only the job finished. That distinction is
       the entire fix. */
    const done = joined({ myStatus: "accepted", coordinatedSinceAccepted: true });
    expect(done.myStatus).toBe("accepted");
    expect(pick(context({ joined: [done] }))?.id).not.toBe("upfor_accepted");
  });

  /**
   * Per-object identity: completing one acceptance must not silence another.
   * Nothing here is a global acknowledgement -- each session carries its own
   * evidence.
   */
  it("does not silence a DIFFERENT accepted UpFor", () => {
    const card = pick(
      context({
        joined: [
          joined({ id: "session-ama", ownerName: "Ama", coordinatedSinceAccepted: true }),
          joined({
            id: "session-kojo",
            ownerId: "owner-kojo",
            ownerName: "Kojo",
            activityType: "gym",
            activityLabel: "Gym",
            coordinatedSinceAccepted: false
          })
        ]
      })
    );
    expect(card?.id).toBe("upfor_accepted");
    expect(card?.title).toBe("Kojo said yes");
  });
});

describe("5. the next opportunity can win", () => {
  /**
   * The point of retiring a finished job: Home has something better to say.
   * With Ama's coordination complete, Kojo's live UpFor takes the slot.
   */
  it("surfaces a new Muddy's UpFor once the previous job is complete", () => {
    const card = pick(
      context({
        joined: [joined({ coordinatedSinceAccepted: true })],
        opportunities: [opportunity()]
      })
    );
    expect(card?.id).toBe("upfor_opportunity");
    expect(card?.title).toBe("Kojo is UpFor gym");
  });

  it("but an unfinished commitment still outranks a new opportunity", () => {
    const card = pick(
      context({
        joined: [joined({ coordinatedSinceAccepted: false })],
        opportunities: [opportunity()]
      })
    );
    expect(card?.id).toBe("upfor_accepted");
  });
});

describe("6. the session ends", () => {
  /**
   * The reader only returns ACTIVE sessions, so an ended, cancelled or
   * converted UpFor leaves every list at once. Home cannot hold a card for a
   * session that no longer exists.
   */
  it("removes every UpFor card for that session", () => {
    const card = pick(context({ joined: [], opportunities: [] }));
    for (const id of ["upfor_opportunity", "upfor_active_muddy", "upfor_accepted"]) {
      expect(card?.id).not.toBe(id);
    }
  });
});

describe("7. multiple UpFors, deterministically", () => {
  it("never assumes a single session anywhere in the lifecycle", () => {
    const card = pick(
      context({
        ownedLive: [
          {
            id: "mine-1",
            activityType: "coffee",
            activityLabel: "Coffee",
            startsAt: null,
            endsAt: null,
            pendingRequestCount: 1,
            acceptedCount: 0
          }
        ],
        joined: [joined(), joined({ id: "j2", ownerId: "o2", ownerName: "Kojo" })],
        opportunities: [opportunity(), opportunity({ id: "s3", ownerId: "o3", ownerName: "Efua" })]
      })
    );
    /* Owning an unanswered request is an obligation and outranks all of it. */
    expect(card?.id).toBe("upfor_requests");
  });

  it("picks the same winner every time for the same input", () => {
    const built = context({
      joined: [joined(), joined({ id: "j2", ownerId: "o2", ownerName: "Kojo" })],
      opportunities: [opportunity()]
    });
    const ids = Array.from({ length: 5 }, () => pick(built)?.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("orders the UpFor family by commitment, not by recency", () => {
    /* accepted (in it) > pending (asked) > opportunity (might join). */
    const accepted = pick(
      context({ joined: [joined()], opportunities: [opportunity()] })
    );
    expect(accepted?.id).toBe("upfor_accepted");

    const pending = pick(
      context({ joined: [joined({ myStatus: "pending" })], opportunities: [opportunity()] })
    );
    expect(pending?.id).toBe("upfor_active_muddy");
  });
});

describe("8. the rest of Home still outranks all of it", () => {
  it("Safe Arrival keeps absolute priority", () => {
    const card = pick(context({ opportunities: [opportunity()], joined: [joined()] }), {
      safeArrival: { travelling: true, watcherCount: 1 }
    });
    expect(card?.id).toBe("safe_arrival");
  });

  it("proximity stays NearbyHero's, never an UpFor card's", () => {
    const card = pick(context({ opportunities: [opportunity()] }));
    const rendered = JSON.stringify(card);
    expect(rendered).not.toMatch(/nearby|close by|around you|\bkm\b|\bmetres?\b/i);
  });
});
