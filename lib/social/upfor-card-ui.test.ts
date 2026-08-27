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

  it("renders the reference's avatar, content, and action columns", () => {
    expect(card).toContain("upfor-card__portrait");
    expect(card).toContain("upfor-card__content");
    expect(card).toContain("upfor-card__rail");
    expect(css).toContain("grid-template-columns: 3.5rem minmax(0, 1fr) 5.75rem");
  });

  it("uses current category art and privacy-safe metadata", () => {
    expect(card).toContain("UpForActivityIcon");
    expect(card).toContain("upForPlaceLabel(upfor)");
    expect(card).toContain("upForSocialProof");
    expect(card).not.toMatch(/metres|coordinates|latitude|longitude/);
  });

  it("keeps expiry and response authority while exposing View", () => {
    expect(card).toContain("upForTimeLeft(upfor.endsAt, nowMs)");
    expect(card).toContain("isOwner ? null : expired ? (");
    expect(card).toContain("I&apos;m in");
    expect(card).toMatch(/>\s*View\s*</);
  });
});
