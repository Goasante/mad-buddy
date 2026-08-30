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

function expectAll(source: string, invariants: RegExp[]) {
  for (const invariant of invariants) expect(source).toMatch(invariant);
}

const connectionModes = between(landing, "const connectionModes = [", "const privacyCanKnow = [");
const muddiesMode = between(connectionModes, 'label: "Muddies"', 'label: "Linkr"');
const linkrMode = connectionModes.slice(connectionModes.indexOf('label: "Linkr"'));
const privacyNeverGet = between(landing, "const privacyNeverGet = [", "const momentumFlow = [");
const momentumFlow = between(landing, "const momentumFlow = [", "const supportingFeatures = [");
const connectionSection = between(landing, "function ConnectionSection()", "function MomentumSection()");
const momentumSection = between(landing, "function MomentumSection()", "function PrivacySection()");

describe("the landing page preserves the product connection model", () => {
  it("models Muddies as existing relationships that require mutual approval", () => {
    expectAll(muddiesMode, [
      /friend|people you already trust/i,
      /both people approve|mutual approval/i
    ]);
    expect(connectionSection).toContain("connectionModes.map");
  });

  it("models Linkr as deliberate discovery beyond people already known", () => {
    expectAll(linkrMode, [
      /discover someone new|people you might want to know/i,
      /session/i,
      /mutual choice|both.*choose/i
    ]);
    expect(connectionSection).toContain("connectionModes.map");
  });

  it("keeps Linkr exposure user-controlled and bounded to an enabled session", () => {
    expectAll(linkrMode, [
      /switch on|turn on|enable/i,
      /Linkr session|discovery.*active|discovery.*on/i,
      /you choose|your choice|on your terms/i
    ]);
  });

  it("keeps UpFor as a first-class named product capability", () => {
    expect(momentumFlow).toMatch(/label:\s*"UpFor"/);
    expect(momentumSection).toMatch(/\bUpFor\b/);
  });
});

describe("the landing page keeps proximity communication privacy-safe", () => {
  it("communicates Muddy proximity without precise tracking primitives", () => {
    expectAll(muddiesMode, [
      /rough sense|privacy-safe proximity|roughly/i,
      /never a map, pin or exact distance|no exact/i
    ]);
  });

  it("keeps Linkr discovery free of exact-location exposure", () => {
    expect(linkrMode).toMatch(/no exact-location reveal|no exact location|without.*exact.*location/i);
  });

  it("explicitly withholds exact coordinates, numerical distance and maps/pins", () => {
    for (const invariant of [
      "Exact GPS coordinates",
      "A live map or map pin",
      "Exact numerical distance"
    ]) {
      expect(privacyNeverGet).toContain(invariant);
    }
  });

  it("also withholds location history", () => {
    expect(privacyNeverGet).toContain("Location history");
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
