import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const landingSource = readFileSync(join(ROOT, "components/landing/landing-page.tsx"), "utf8");

const landing = landingSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing structured landing block: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing structured landing boundary: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const connectionModes = between(landing, "const connectionModes = [", "const privacyCanKnow = [");
const muddiesMode = between(connectionModes, 'label: "Muddies"', 'label: "Linkr"');
const linkrMode = connectionModes.slice(connectionModes.indexOf('label: "Linkr"'));
const privacyNeverGet = between(landing, "const privacyNeverGet = [", "const momentumFlow = [");
const momentumFlow = between(landing, "const momentumFlow = [", "const supportingFeatures = [");
const connectionSection = between(landing, "function ConnectionSection()", "function MomentumSection()");
const momentumSection = between(landing, "function MomentumSection()", "function PrivacySection()");

describe("the landing page keeps the product's real connection model", () => {
  it("keeps Muddies as mutually approved existing relationships", () => {
    expect(muddiesMode).toMatch(/friendship|people you already trust/i);
    expect(muddiesMode).toMatch(/both people approve|mutual approval/i);
    expect(connectionSection).toContain("connectionModes.map");
  });

  it("keeps Linkr as deliberate discovery of people not already known", () => {
    expect(linkrMode).toMatch(/discover someone new|people you might want to know/i);
    expect(linkrMode).toMatch(/Linkr session/i);
    expect(linkrMode).toMatch(/mutual choice/i);
    expect(connectionSection).toContain("connectionModes.map");
  });

  it("keeps Linkr exposure user-controlled and session-bounded", () => {
    expect(linkrMode).toMatch(/switch on a Linkr session/i);
    expect(linkrMode).toMatch(/choose when discovery is active|choose when discovery is on/i);
  });

  it("keeps UpFor as a real named capability in the momentum story", () => {
    expect(momentumFlow).toMatch(/label:\s*"UpFor"/);
    expect(momentumSection).toMatch(/UpFor\s*·\s*right now/i);
    expect(momentumSection).toMatch(/Temporary intent/i);
  });
});

describe("the landing page keeps proximity communication privacy-safe", () => {
  it("never turns a Muddy's Glow into precise location", () => {
    expect(muddiesMode).toMatch(/rough sense|privacy-safe proximity/i);
    expect(muddiesMode).toMatch(/never a map, pin or exact distance/i);
  });

  it("keeps Linkr discovery free of exact-location exposure", () => {
    expect(linkrMode).toMatch(/No exact-location reveal/i);
  });

  it("explicitly withholds the tracking primitives", () => {
    for (const invariant of [
      "Exact GPS coordinates",
      "A live map or map pin",
      "Exact numerical distance",
      "Location history"
    ]) {
      expect(privacyNeverGet).toContain(invariant);
    }
  });

  it("does not restore false exclusivity claims about who may appear nearby", () => {
    expect(landing).not.toContain("Only Muddies you both approve can appear nearby");
    expect(landing).not.toContain("Only approved friends can see when you");
  });
});

describe("the page stays compressed rather than regrowing duplicate story blocks", () => {
  it("does not render the same step list twice", () => {
    expect(landingSource).not.toContain("const momentSteps = [");
  });

  it("does not render the privacy points three times", () => {
    expect(landingSource).not.toContain("const momentTrustPoints = [");
  });

  it("keeps one final call to action", () => {
    expect(landing).not.toContain("Ready to meet naturally?");
  });
});
