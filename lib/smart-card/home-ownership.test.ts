import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = readFileSync(
  join(__dirname, "..", "..", "components", "dashboard", "dashboard-page.tsx"),
  "utf8"
);
const providers = readFileSync(join(__dirname, "providers.ts"), "utf8");
const gate = readFileSync(join(__dirname, "home-gate.ts"), "utf8");

describe("Home heartbeat ownership boundaries", () => {
  it("removes retired Safe Arrival ownership from Home", () => {
    expect(home).not.toContain('smartCard?.id === "safe_arrival"');
    expect(home).not.toContain("safeArrivalTravellingForSection");
    expect(home).not.toContain("hasSafeArrivalSection");
    expect(home).toContain("<SmartCardHeroV2 card={smartCard}");
  });

  it("keeps Nearby out of the Home Smart Card while retaining the provider for other surfaces", () => {
    expect(home).toContain("<SmartCardHeroV2 card={smartCard}");
    expect(providers).toContain('id: "nearby_muddies"');
    expect(gate).toContain('nearby_muddies: "NearbyHero"');
  });

  it("literal Plan-creation actions open the Plan creation flow", () => {
    expect(providers).toContain('secondaryAction: { label: "Make a Plan", destination: "/plans?create=1" }');
    expect(providers).toContain('destination: birthdayToday ? "/profile" : "/plans?create=1"');
    expect(providers).toContain('destination: count > 0 ? "/plans" : "/plans?create=1"');
  });
});
