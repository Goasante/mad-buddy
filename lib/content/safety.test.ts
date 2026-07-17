import { describe, expect, it } from "vitest";
import {
  BLOCK_REVOKES,
  assessSpam,
  detectLocationRisk,
  isReportCategory,
  requiresHumanReview
} from "@/lib/content/safety";

describe("report categories (spec §49)", () => {
  it("recognizes valid categories and rejects junk", () => {
    expect(isReportCategory("harassment")).toBe(true);
    expect(isReportCategory("dangerous_location_sharing")).toBe(true);
    expect(isReportCategory("nonsense")).toBe(false);
  });

  it("routes serious categories to human review", () => {
    expect(requiresHumanReview("threat_or_violence")).toBe(true);
    expect(requiresHumanReview("private_information")).toBe(true);
    expect(requiresHumanReview("spam")).toBe(false);
  });
});

describe("block revocation surface (spec §51)", () => {
  it("covers every surface the spec requires a block to revoke", () => {
    for (const surface of [
      "friendship",
      "glow",
      "status",
      "waves",
      "pings",
      "messaging",
      "moments",
      "drops",
      "event_glow",
      "future_invitations"
    ]) {
      expect(BLOCK_REVOKES).toContain(surface);
    }
  });
});

describe("exact-location warning (spec §55)", () => {
  it("flags decimal coordinates", () => {
    const result = detectLocationRisk("meet me at 5.6037, -0.1870");
    expect(result.warn).toBe(true);
    expect(result.signals).toContain("coordinates");
  });

  it("flags a street address", () => {
    expect(detectLocationRisk("I live at 12 Oxford Street").signals).toContain("street_address");
  });

  it("flags live-location wording", () => {
    expect(detectLocationRisk("here's my location, come find me").signals).toContain("live_location_wording");
  });

  it("flags vulnerability wording", () => {
    expect(detectLocationRisk("I'm alone at the library").signals).toContain("alone_wording");
  });

  it("does NOT warn on ordinary public meeting places — warning on everything trains users to ignore it", () => {
    expect(detectLocationRisk("meet at the Student Centre at 4").warn).toBe(false);
    expect(detectLocationRisk("we're at Accra Mall").warn).toBe(false);
    expect(detectLocationRisk("football at Legon Park").warn).toBe(false);
    expect(detectLocationRisk("library is quiet today").warn).toBe(false);
    expect(detectLocationRisk("").warn).toBe(false);
  });
});

describe("spam heuristics (spec §54)", () => {
  it("flags excessive links, repetition, and volume", () => {
    expect(assessSpam({ text: "a http://x.com b http://y.com c http://z.com", recentPostCount: 1, identicalRecentCount: 0 }).signals).toContain(
      "excessive_links"
    );
    expect(assessSpam({ text: "hi", recentPostCount: 1, identicalRecentCount: 3 }).signals).toContain("repetition");
    expect(assessSpam({ text: "hi", recentPostCount: 20, identicalRecentCount: 0 }).signals).toContain(
      "excessive_posting"
    );
  });

  it("leaves ordinary content alone", () => {
    expect(assessSpam({ text: "we're getting food after class", recentPostCount: 2, identicalRecentCount: 0 })).toEqual({
      suspicious: false,
      signals: []
    });
  });
});
