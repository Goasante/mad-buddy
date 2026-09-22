import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(__dirname, "..", "..", "components", "glow", "muddy-profile-modal.tsx"),
  "utf8"
);

describe("Muddy profile modal design contract", () => {
  it("uses the custom identity-led sheet instead of the generic visible title bar", () => {
    expect(source).toContain("hideTitle");
    expect(source).toContain('owner="MuddyProfileModal"');
    expect(source).toContain('size="hero"');
  });

  it("keeps Wave as the primary action and Ping/Message as secondary actions", () => {
    expect(source).toContain("bg-gradient-to-r from-[#F79A32]");
    expect(source).toContain("grid grid-cols-2 gap-2.5");
    expect(source).toContain(">\n              Ping\n");
    expect(source).toContain('"Message"');
  });

  it("does not render confidence copy in the popup", () => {
    expect(source).not.toContain("muddy.confidence ?");
    expect(source).not.toContain("confidence</span>");
    expect(source).toContain("glow confidence|\\bconfidence\\b");
  });

  it("keeps the full profile handoff as a distinct bottom row", () => {
    expect(source).toContain("View full profile");
    expect(source).toContain("<UserRound");
    expect(source).toContain("<ArrowRight");
  });
});
