import { describe, expect, it } from "vitest";
import {
  canManageEvent,
  canViewEvent,
  isBroadlyRankable,
  isDiscoverableInFeed,
  isEventOwner
} from "@/lib/events/rules";

/**
 * The five-audience model.
 *
 * Three questions that are deliberately NOT the same: may I find this by
 * browsing, may I open one I was sent, and may this be called trending. An
 * audience model that answers them with one rule either leaks unlisted Events
 * into the feed or refuses to open a link that was deliberately shared.
 */

const HOST = "host-1";
const VIEWER = "viewer-1";

const at = (visibility: string, extra: Record<string, unknown> = {}) => ({
  visibility,
  hostId: HOST,
  status: "scheduled",
  ...extra
});

describe("browsing: what shows up in discovery", () => {
  it("shows public Events to anyone", () => {
    expect(isDiscoverableInFeed(at("public"), VIEWER)).toBe(true);
  });

  it("shows nearby Events to anyone (geography filters them later)", () => {
    expect(isDiscoverableInFeed(at("nearby"), VIEWER)).toBe(true);
  });

  it("never browses an unlisted link Event", () => {
    expect(isDiscoverableInFeed(at("link"), VIEWER)).toBe(false);
  });

  it("never browses a private invite Event, even for the invitee", () => {
    // Being invited means you can OPEN it, not that it joins the public feed.
    expect(isDiscoverableInFeed(at("invite", { isInvited: true }), VIEWER)).toBe(false);
  });

  it("shows a targeted community Event to its members only", () => {
    const targeted = { hasCommunityTarget: true };
    expect(isDiscoverableInFeed(at("community", { ...targeted, isCommunityMember: true }), VIEWER)).toBe(true);
    expect(isDiscoverableInFeed(at("community", { ...targeted, isCommunityMember: false }), VIEWER)).toBe(false);
  });

  it("fails closed for an untargeted legacy community Event", () => {
    /* Community means members of a selected community. A missing target is
     * incomplete authority, not permission to expose the Event broadly. */
    expect(isDiscoverableInFeed(at("community"), VIEWER)).toBe(false);
  });

  it("always shows a host their own Event", () => {
    for (const v of ["invite", "link", "community", "nearby", "public"]) {
      expect(isDiscoverableInFeed(at(v), HOST), v).toBe(true);
    }
  });

  it("fails closed on an audience it does not recognise", () => {
    expect(isDiscoverableInFeed(at("everyone_ever"), VIEWER)).toBe(false);
  });
});

describe("direct access: opening an Event you were sent", () => {
  it("opens an unlisted link Event for whoever holds the link", () => {
    // Holding the id IS the permission -- otherwise "share a link" cannot work.
    expect(canViewEvent(at("link"), VIEWER)).toBe(true);
  });

  it("is deliberately more permissive than browsing", () => {
    expect(isDiscoverableInFeed(at("link"), VIEWER)).toBe(false);
    expect(canViewEvent(at("link"), VIEWER)).toBe(true);
  });

  it("opens a private Event for an invited person", () => {
    expect(canViewEvent(at("invite", { isInvited: true }), VIEWER)).toBe(true);
  });

  it("refuses a private Event for anyone not invited", () => {
    expect(canViewEvent(at("invite", { isInvited: false }), VIEWER)).toBe(false);
    expect(canViewEvent(at("invite"), VIEWER)).toBe(false);
  });

  it("refuses a targeted community Event for a non-member", () => {
    expect(
      canViewEvent(at("community", { hasCommunityTarget: true, isCommunityMember: false }), VIEWER)
    ).toBe(false);
  });

  it("never opens someone else's draft, whatever the audience", () => {
    for (const v of ["public", "nearby", "link", "community"]) {
      expect(canViewEvent({ ...at(v), status: "draft" }, VIEWER), v).toBe(false);
    }
    // The host still reaches their own unpublished Event.
    expect(canViewEvent({ ...at("public"), status: "draft" }, HOST)).toBe(true);
  });

  it("fails closed on an unrecognised audience", () => {
    expect(canViewEvent(at("everyone_ever"), VIEWER)).toBe(false);
  });
});

describe("broad ranking is stricter than browsing", () => {
  it("ranks only public and nearby Events", () => {
    expect(isBroadlyRankable({ visibility: "public" })).toBe(true);
    expect(isBroadlyRankable({ visibility: "nearby" })).toBe(true);
  });

  it("never ranks a private, unlisted or community Event", () => {
    /* A private wedding with thousands Going must not become "#12 trending",
     * and a Circle's Event is discoverable to its members without being a
     * claim about the whole product. */
    for (const v of ["invite", "link", "community"]) {
      expect(isBroadlyRankable({ visibility: v }), v).toBe(false);
    }
  });

  it("is decided before any score exists", () => {
    // Eligibility takes only the audience -- there is no count to weigh it
    // against, which is what makes "visibility precedes score" structural.
    expect(isBroadlyRankable({ visibility: "invite" })).toBe(false);
  });
});

describe("who may act for the Event", () => {
  it("lets the host manage it", () => {
    expect(canManageEvent({ hostId: HOST }, HOST, false)).toBe(true);
  });

  it("lets an Event admin manage it", () => {
    expect(canManageEvent({ hostId: HOST }, VIEWER, true)).toBe(true);
  });

  it("refuses an ordinary attendee", () => {
    expect(canManageEvent({ hostId: HOST }, VIEWER, false)).toBe(false);
  });

  it("keeps ownership actions to the host alone", () => {
    // Appointing admins and cancelling are not delegated: an admin who could
    // appoint admins is an owner by another name.
    expect(isEventOwner({ hostId: HOST }, HOST)).toBe(true);
    expect(isEventOwner({ hostId: HOST }, VIEWER)).toBe(false);
  });
});
