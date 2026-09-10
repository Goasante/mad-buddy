import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const card = read("components/hangout/upfor-card.tsx");
const feed = read("lib/social/upfor-feed.ts");
const css = read("app/globals.css");

describe("approved compact UpFor activity card", () => {
  it("preserves the four current feed modes", () => {
    for (const label of ["For You", "Muddies", "Around", "Groups"]) expect(feed).toContain(label);
    expect(feed).not.toContain("All Hangouts");
  });

  it("renders the reference's avatar, content, and a full-width action row", () => {
    /* Restructured 2026-09-10: the timer moved from a narrow rail item to a
     * corner badge on the head row, and Accepted/Pending/View/overflow became
     * one full-width row -- a status pill needs room beside real buttons,
     * which the previous fixed narrow rail column could not give it. */
    expect(card).toContain("upfor-card__portrait");
    expect(card).toContain("upfor-card__content");
    expect(card).toContain("upfor-card__head");
    expect(card).toContain("upfor-card__actions");
    expect(css).toContain(".upfor-card__actions {");
  });

  it("uses current category art and privacy-safe metadata", () => {
    expect(card).toContain("UpForActivityIcon");
    expect(card).toContain("upForPlaceLabel(upfor)");
    expect(card).toContain("upForSocialProof");
    expect(card).not.toMatch(/metres|coordinates|latitude|longitude/);
  });

  it("keeps expiry and response authority while exposing View", () => {
    /* The time line now comes from the phase-aware helper rather than
       upForTimeLeft: a scheduled UpFor counts down to its START, a running
       one to its end, and a terminal one shows nothing. The invariant is
       unchanged -- the card derives expiry from canonical timestamps and
       persists no countdown -- so that is what is asserted. */
    expect(card).toContain("upForCountdownLabel(upfor, nowMs)");
    expect(card).toContain("timeLabel");
    expect(card).toContain("isOwner ? null : expired ? (");
    expect(card).toContain("I&apos;m in");
    expect(card).toMatch(/>\s*View\s*</);
  });

  it("shows a read-only status pill for an accepted or pending viewer, not a button", () => {
    /* The pill states a fact ("Accepted" / "Pending"); withdrawing is a
     * separate, deliberately one-more-tap action behind the overflow menu, so
     * checking your own attendance can never accidentally cancel it. */
    expect(card).toContain("upfor-card__status--going");
    expect(card).toContain("upfor-card__status--requested");
    expect(card).toContain("AppMenu");
    expect(card).toContain('accepted ? "Leave" : "Cancel request"');
  });
});
