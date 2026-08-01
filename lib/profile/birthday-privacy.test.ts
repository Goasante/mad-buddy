import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(join(process.cwd(), "lib", "profile", "birthday-service.ts"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

describe("birthday privacy and presentation guards", () => {
  it("requires approved visibility, an active friendship, no block, and an enabled owner preference", () => {
    expect(service).toContain('privacyResult.data?.visibility === "approved_muddies"');
    expect(service).toContain('.from("friendships")');
    expect(service).toContain('isBlockedEitherDirection');
    expect(service).toContain('ownerPrefs.birthdayAnnouncementsEnabled');
  });

  it("does not put DOB or age into analytics", () => {
    for (const eventName of ["birthday_notification_sent", "birthday_wish_sent"]) {
      expect(service).toContain(eventName);
    }
    const analyticsBlocks = service.match(/recordProductEvent\([\s\S]*?\}\);/g)?.join("\n") ?? "";
    expect(analyticsBlocks).not.toContain("date_of_birth");
    expect(analyticsBlocks).not.toContain("age:");
  });

  it("disables birthday animation for reduced-motion users", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".birthday-accent__ring");
    expect(css).toContain("animation: none !important");
  });
});
