import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = readFileSync(
  join(__dirname, "..", "..", "components", "dashboard", "dashboard-page.tsx"),
  "utf8"
);
const providers = readFileSync(join(__dirname, "providers.ts"), "utf8");

describe("Home heartbeat ownership boundaries", () => {
  it("does not repeat the traveller Safe Arrival when the Smart Card already owns it", () => {
    expect(home).toContain('smartCard?.id === "safe_arrival"');
    expect(home).toContain("safeArrival?.travelling.slice(1) ?? []");
    expect(home).toContain("safeArrivalTravellingForSection.map");
    expect(home).toContain("hasSafeArrivalSection");
  });

  it("keeps Nearby out of the Home Smart Card while retaining the provider for other surfaces", () => {
    expect(home).toContain("smartCard={smartCard}");
    expect(providers).toContain('id: "nearby_muddies"');
  });

  it("literal Plan-creation actions open the Plan creation flow", () => {
    expect(providers).toContain('secondaryAction: { label: "Make a Plan", destination: "/plans?create=1" }');
    expect(providers).toContain('destination: birthdayToday ? "/profile" : "/plans?create=1"');
    expect(providers).toContain('destination: count > 0 ? "/plans" : "/plans?create=1"');
  });
});
