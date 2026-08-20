import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { isDiscoverableInFeed } from "@/lib/events/rules";
import { isRankableEvent, scoreEvent, type RankableEvent } from "@/lib/events/ranking";

/**
 * Who may find an Event by browsing.
 *
 * An unlisted Event that appears in the feed is not unlisted. Two surfaces --
 * the Events list and the ranking candidate query -- each used to carry their
 * own copy of this rule, and both let `link` through. These tests pin the one
 * shared answer, and that visibility is decided before any score.
 */

const HOST = "host-1";
const VIEWER = "viewer-1";

const ev = (visibility: string, hostId = HOST) => ({ visibility, hostId });

describe("browsing the Events feed", () => {
  it("shows community Events to anyone", () => {
    expect(isDiscoverableInFeed(ev("community"), VIEWER)).toBe(true);
  });

  it("keeps an unlisted link Event out of the feed", () => {
    // "Anyone with the link" is not "everyone". Appearing in discovery is the
    // one thing an unlisted Event must not do.
    expect(isDiscoverableInFeed(ev("link"), VIEWER)).toBe(false);
  });

  it("keeps a private invite Event out of the feed", () => {
    expect(isDiscoverableInFeed(ev("invite"), VIEWER)).toBe(false);
  });

  it("always shows a host their own Event, whatever its audience", () => {
    for (const visibility of ["invite", "link", "community"]) {
      expect(isDiscoverableInFeed(ev(visibility), HOST)).toBe(true);
    }
  });

  it("refuses an audience it does not recognise", () => {
    // Fails closed: a new audience value must be granted discovery
    // deliberately, never inherit it by falling through a !== check.
    expect(isDiscoverableInFeed(ev("some_future_audience"), VIEWER)).toBe(false);
  });
});

describe("visibility precedes score", () => {
  const base: RankableEvent = {
    id: "e1",
    status: "scheduled",
    startsAtMs: Date.now() + 86_400_000,
    endsAtMs: Date.now() + 90_000_000,
    goingCount: 5000,
    interestedCount: 20000,
    recentGoingCount: 900,
    recentInterestedCount: 3000
  };

  it("a hugely popular private Event is never eligible for the feed", () => {
    /* A private wedding with 5,000 Going must not become "#12 trending".
     * Its score is irrelevant; the audience answer comes first. */
    expect(isDiscoverableInFeed(ev("invite"), VIEWER)).toBe(false);
    expect(scoreEvent(base, Date.now())).toBeGreaterThan(0);
  });

  it("an unlisted Event is likewise excluded however popular", () => {
    expect(isDiscoverableInFeed(ev("link"), VIEWER)).toBe(false);
  });

  it("still refuses cancelled, draft and ended Events on status alone", () => {
    const now = Date.now();
    for (const status of ["cancelled", "draft", "ended"] as const) {
      expect(isRankableEvent({ ...base, status }, now)).toBe(false);
    }
  });

  it("refuses an Event that has already finished", () => {
    const now = Date.now();
    expect(isRankableEvent({ ...base, endsAtMs: now - 1 }, now)).toBe(false);
  });
});

describe("both discovery surfaces share one rule", () => {
  const feed = stripComments(readFileSync("lib/events/mobile.ts", "utf8"));
  const ranked = stripComments(readFileSync("lib/events/ranked-events.ts", "utf8"));

  it("the Events list defers to the shared authority", () => {
    expect(feed).toContain("isDiscoverableInFeed(");
  });

  it("the ranking candidate query uses the stricter broad-ranking authority", () => {
    // Same module, different question: feed discovery admits community Events
    // for their members; broad ranking does not admit them at all.
    expect(ranked).toContain("isBroadlyRankable(");
  });

  it("neither keeps a private copy of the audience rule", () => {
    // The duplicated form is what let `link` through in two places at once.
    expect(feed).not.toContain('visibility !== "invite"');
    expect(ranked).not.toContain('visibility !== "invite"');
  });

  it("a host's own draft still reaches them, and nobody else", () => {
    expect(feed).toContain('event.status === "draft" && event.host_id !== userId');
  });
});
