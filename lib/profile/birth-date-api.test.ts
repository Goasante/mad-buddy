import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const publicRoute = readFileSync(
  join(process.cwd(), "app", "api", "users", "[id]", "route.ts"),
  "utf8"
);
const publicProjection = readFileSync(join(process.cwd(), "lib", "profile", "public.ts"), "utf8");
const analyticsRegistry = readFileSync(
  join(process.cwd(), "lib", "analytics", "product-analytics.ts"),
  "utf8"
);
const profileService = readFileSync(join(process.cwd(), "lib", "profile", "service.ts"), "utf8");
const onboardingService = readFileSync(join(process.cwd(), "lib", "onboarding", "complete.ts"), "utf8");

describe("birth-date API and analytics privacy", () => {
  it("routes public profile reads through the safe profile projection", () => {
    expect(publicRoute).toContain("getPublicProfile");
    expect(publicRoute).not.toContain("profile_birth_details");
    expect(publicRoute).not.toContain("date_of_birth");
  });

  it("does not define a raw birth date on the public profile response", () => {
    const publicType = publicProjection.slice(
      publicProjection.indexOf("export type PublicProfile"),
      publicProjection.indexOf("const uuidSchema")
    );
    expect(publicType).not.toContain("dateOfBirth");
    expect(publicType).not.toContain("date_of_birth");
  });

  it("registers safe lifecycle event names without sensitive birth attributes", () => {
    for (const eventName of [
      "birth_date_added",
      "birth_date_updated",
      "birthday_visibility_changed",
      "age_visibility_changed",
      "zodiac_visibility_changed"
    ]) {
      expect(analyticsRegistry).toContain(`\"${eventName}\"`);
    }
    expect(analyticsRegistry).not.toContain("birth_year");
    const analyticsCalls = [profileService, onboardingService]
      .flatMap((source) => source.match(/recordProductEvent\([\s\S]*?\}\);/g) ?? [])
      .join("\n");
    expect(analyticsCalls).not.toContain("date_of_birth");
    expect(analyticsCalls).not.toContain("dateOfBirth");
    expect(analyticsCalls).not.toMatch(/\bage\s*:/);
    expect(analyticsCalls).not.toContain("zodiacSign");
  });
});
