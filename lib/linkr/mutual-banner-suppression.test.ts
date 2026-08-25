import { describe, expect, it } from "vitest";

/**
 * Which mutual signals become a first-connector banner, and which are already
 * being shown as the full mutual screen.
 *
 * The rule extracted here is the one the Linkr page applies to every live
 * `linkr_connection` event. It is tested as behaviour -- a sequence of things
 * that happen in a session -- rather than by reading the component's source.
 *
 * WHY THIS EXISTS. The second connector is shown the mutual screen as the
 * direct answer to their own tap. The server writes the SAME notification to
 * both people, so that person's own tab also receives a live event for the
 * connection it just created. Without suppression they get the news twice:
 * once full screen, once as a banner behind it.
 *
 * The subtle case, and the one that regressed: the notification can arrive
 * while the Connect request is STILL IN FLIGHT, before the connection id is
 * known. Recognising the target id is what closes that window.
 */

type Session = {
  /** Set the moment Connect is tapped; cleared when the request settles. */
  connectingTargetId: string | null;
  /** Set once the server confirms which connection this tab completed. */
  completedConnectionId: string | null;
};

/** The predicate the live handler applies before raising a banner. */
function shouldShowBanner(
  session: Session,
  event: { connectionId: string; otherUserId: string }
): boolean {
  if (event.connectionId === session.completedConnectionId) return false;
  if (event.otherUserId === session.connectingTargetId) return false;
  return true;
}

const CONNECTION = "conn-1";
const B = "user-b";
const C = "user-c";

describe("the person completing reciprocity is not told twice", () => {
  it("suppresses the event for a connection this tab just completed", () => {
    const session: Session = { connectingTargetId: null, completedConnectionId: CONNECTION };
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(false);
  });

  it("suppresses it even while the Connect request is still in flight", () => {
    // The id is not known yet -- this is the window the first version missed.
    const session: Session = { connectingTargetId: B, completedConnectionId: null };
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(false);
  });
});

describe("the person who clicked first still gets told", () => {
  it("shows a banner for reciprocity completed by somebody else", () => {
    const session: Session = { connectingTargetId: null, completedConnectionId: null };
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(true);
  });

  it("does not mute an unrelated match arriving mid-swipe", () => {
    // Mid-Connect on C, and B returns an earlier interest: still news.
    const session: Session = { connectingTargetId: C, completedConnectionId: null };
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(true);
  });

  it("announces the same person again once the claim is released", () => {
    const session: Session = { connectingTargetId: B, completedConnectionId: null };
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(false);

    // The request settled without a match (one-sided). Releasing the claim is
    // what lets tomorrow's genuine reciprocity still raise a banner; leaving
    // it set would mute this person for the rest of the session.
    session.connectingTargetId = null;
    expect(shouldShowBanner(session, { connectionId: CONNECTION, otherUserId: B })).toBe(true);
  });
});
