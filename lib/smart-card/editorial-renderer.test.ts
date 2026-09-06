import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const renderer = fs.readFileSync(
  path.join(process.cwd(), "components/journey/smart-card-v2.tsx"),
  "utf8"
);

describe("Smart Card editorial renderer", () => {
  it("uses the approved cinematic dark-card hierarchy instead of a full orange gradient", () => {
    expect(renderer).toContain('data-smart-card-editorial="true"');
    expect(renderer).toContain("bg-[#0b0a09]");
    expect(renderer).toContain("border-[#e88c2b]/75");
    expect(renderer).toContain("bg-[#ff7417]");
    expect(renderer).toContain("linear-gradient(90deg,rgba(7,7,6,0.98)");
    expect(renderer).not.toContain('return "from-[#67100b] via-[#9a2e18] to-[#e88c2b]"');
  });

  it("makes truthful card media the full-bleed stage and keeps neutral art as fallback", () => {
    expect(renderer).toContain("const hasTruthfulMedia = Boolean(card.media?.url)");
    expect(renderer).toContain("hasTruthfulMedia ? card.media!.url");
    expect(renderer).toContain("ILLUSTRATIONS[card.illustration]");
    expect(renderer).toContain("A display name is never a gender authority");
    expect(renderer).not.toMatch(/ownerName.*male|ownerName.*female|displayName.*male|displayName.*female/);
  });

  it("keeps Safe Arrival on approved non-tracking artwork", () => {
    expect(renderer).toContain('const SAFE_ARRIVAL_ART = "/visuals/safe-arrival/active.jpg"');
    expect(renderer).toContain("safety ? SAFE_ARRIVAL_ART : null");
    expect(renderer).toContain("never borrows a person, map, route or generic Event image");
  });

  it("preserves quiet Card B treatment, secondary actions and accessible touch targets", () => {
    expect(renderer).toContain('const quiet = treatment === "quiet"');
    expect(renderer).toContain('card.secondaryAction ? "grid-cols-2" : "grid-cols-1"');
    expect(renderer).toContain("min-h-11");
    expect(renderer).toContain("card.secondaryAction.destination");
  });
});
