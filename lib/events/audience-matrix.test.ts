import { describe, expect, it } from "vitest";
import {
  canViewEvent,
  isBroadlyRankable,
  isDiscoverableInFeed,
  type EventAudienceContext
} from "@/lib/events/rules";

/**
 * The five Event audiences, against all three authorities.
 *
 * These answer three genuinely different questions and must never be collapsed
 * into one "can see event" check:
 *
 *   isDiscoverableInFeed  may this be BROWSED to?
 *   canViewEvent          may this be OPENED when the id is already held?
 *   isBroadlyRankable     may this claim to be trending across Mad Buddy?
 *
 * The gap between the first two is the entire point of an unlisted audience:
 * a `link` Event is not browsable but IS openable, because holding the link is
 * the permission. Collapsing them would either break sharing or leak private
 * Events into the feed.
 *
 * The third is stricter than both on purpose. A community Event is legitimately
 * discoverable by its members, but "trending" is a claim about the whole
 * product, and an Event whose audience is one Circle has not earned it.
 */

const HOST = "host-user";
const STRANGER = "stranger-user";

function context(overrides: Partial<EventAudienceContext> = {}): EventAudienceContext {
  return {
    hostId: HOST,
    visibility: "public",
    hasCommunityTarget: false,
    isCommunityMember: false,
    isInvited: false,
    ...overrides
  } as EventAudienceContext;
}

/** The full matrix, as the product intends it. */
const MATRIX = [
  // visibility   discoverable  viewable  rankable
  ["public",      true,         true,     true],
  ["nearby",      true,         true,     true],
  ["community",   true,         true,     false], // untargeted (legacy)
  ["link",        false,        true,     false],
  ["invite",      false,        false,    false]
] as const;

describe("Event audiences: three authorities, five audiences", () => {
  for (const [visibility, discoverable, viewable, rankable] of MATRIX) {
    it(`${visibility}: discoverable=${discoverable} viewable=${viewable} rankable=${rankable}`, () => {
      const event = context({ visibility });
      expect(isDiscoverableInFeed(event, STRANGER)).toBe(discoverable);
      expect(canViewEvent({ ...event, status: "published" }, STRANGER)).toBe(viewable);
      expect(isBroadlyRankable({ visibility })).toBe(rankable);
    });
  }

  it("link is the asymmetry: not browsable, but openable by anyone holding it", () => {
    /* Stated separately because it is the property most likely to be
       "simplified" away by someone who assumes the two questions are the same.
       Sharing is TRANSPORT: possessing the URL is what grants access for this
       audience, and that must not make the Event appear in anyone's feed. */
    const linkEvent = context({ visibility: "link" });
    expect(isDiscoverableInFeed(linkEvent, STRANGER)).toBe(false);
    expect(canViewEvent({ ...linkEvent, status: "published" }, STRANGER)).toBe(true);
  });

  it("invite is decided by the invite list, not by the audience value alone", () => {
    const uninvited = context({ visibility: "invite", isInvited: false });
    const invited = context({ visibility: "invite", isInvited: true });
    expect(canViewEvent({ ...uninvited, status: "published" }, STRANGER)).toBe(false);
    expect(canViewEvent({ ...invited, status: "published" }, STRANGER)).toBe(true);
    // Being invited still does not put it in the browse feed.
    expect(isDiscoverableInFeed(invited, STRANGER)).toBe(false);
  });

  it("a TARGETED community Event is members-only, in both browse and open", () => {
    const outsider = context({ visibility: "community", hasCommunityTarget: true, isCommunityMember: false });
    const member = context({ visibility: "community", hasCommunityTarget: true, isCommunityMember: true });

    expect(isDiscoverableInFeed(outsider, STRANGER)).toBe(false);
    expect(canViewEvent({ ...outsider, status: "published" }, STRANGER)).toBe(false);

    expect(isDiscoverableInFeed(member, STRANGER)).toBe(true);
    expect(canViewEvent({ ...member, status: "published" }, STRANGER)).toBe(true);

    // But never broadly rankable, member or not: "trending" is a claim about
    // the whole product.
    expect(isBroadlyRankable({ visibility: "community" })).toBe(false);
  });

  it("a draft is invisible to everyone except its host, whatever the audience", () => {
    for (const [visibility] of MATRIX) {
      const draft = { ...context({ visibility }), status: "draft" };
      expect(canViewEvent(draft, STRANGER), `${visibility} draft leaked`).toBe(false);
      // The host still sees their own.
      expect(canViewEvent(draft, HOST), `${visibility} draft hidden from host`).toBe(true);
    }
  });

  it("an unknown audience fails CLOSED", () => {
    /* The default branch matters more than the named ones: a future audience
       added to the database but not to these switches must deny, not permit. */
    const unknown = { ...context({ visibility: "some_future_audience" }), status: "published" };
    expect(isDiscoverableInFeed(unknown, STRANGER)).toBe(false);
    expect(canViewEvent(unknown, STRANGER)).toBe(false);
    expect(isBroadlyRankable({ visibility: "some_future_audience" })).toBe(false);
  });

  it("the host always sees their own Event, in every audience", () => {
    for (const [visibility] of MATRIX) {
      const event = context({ visibility });
      expect(isDiscoverableInFeed(event, HOST), `${visibility} hidden from host`).toBe(true);
      expect(canViewEvent({ ...event, status: "published" }, HOST)).toBe(true);
    }
  });

  it("sharing cannot widen ranking: no audience makes a private Event trend", () => {
    // Ranking depends on visibility alone — not on invite count, not on
    // membership, not on how widely a link was shared.
    for (const visibility of ["invite", "link", "community"]) {
      expect(isBroadlyRankable({ visibility }), `${visibility} became rankable`).toBe(false);
    }
  });
});
