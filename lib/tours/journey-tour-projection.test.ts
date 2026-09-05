import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MANAGED_FEATURES } from "@/lib/features/feature-flags";
import { replayableTours } from "@/lib/tours/model";

/**
 * Journey/Profile tour query budget.
 *
 * Measured on staging, getReplayableTours() cost ~1115ms inside Journey --
 * essentially the whole remaining Journey floor -- while Journey used exactly
 * two fields from the result: `slug` and `tourVersionId`. Everything else
 * (every step body, media path, CTA and entitlement key, plus per-tour copy
 * resolution and a progress read) was built and thrown away on every
 * /api/profile GET.
 *
 * These tests hold the budget: Journey takes the narrow reference projection,
 * eligibility stays server-side and identical, and the flag reads stay batched.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Strip comments so prose about a call is never mistaken for the call. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const journey = codeOf(read("lib/journey/journey-service.ts"));
const tours = codeOf(read("lib/tours/service.ts"));
const flags = codeOf(read("lib/features/feature-flags.ts"));

describe("Journey uses the narrow tour reference projection", () => {
  it("calls getReplayableTourRefs, not the full replay loader", () => {
    expect(journey).toMatch(/getReplayableTourRefs\s*\(/);
    expect(journey).not.toMatch(/getReplayableTours\s*\(/);
  });

  it("still builds the same slug -> version id map", () => {
    // The product contract Journey depends on must not change.
    expect(journey).toMatch(/tour\.slug/);
    expect(journey).toMatch(/tour\.tourVersionId/);
  });
});

describe("the narrow projection keeps eligibility server-side", () => {
  const refs = /export async function getReplayableTourRefs[\s\S]*?\n}/.exec(tours)?.[0] ?? "";

  it("exists", () => {
    expect(refs).not.toBe("");
  });

  it("applies the same subject and live-window filtering", () => {
    // Eligibility must be decided on the server, by the same rules -- never
    // handed to the client to work out.
    expect(refs).toMatch(/loadSubject\(/);
    expect(refs).toMatch(/loadPublishedVersions\(/);
    expect(refs).toMatch(/replayableTours\(/);
  });

  it("returns only references, never resolved tour payloads", () => {
    expect(refs).toMatch(/slug/);
    expect(refs).toMatch(/tourVersionId/);
    expect(refs).not.toMatch(/\bresolve\(/);
  });

  it("skips the per-user progress read a reference does not need", () => {
    expect(refs).not.toMatch(/loadProgress\(/);
  });
});

describe("feature flags are read in one batched query", () => {
  it("loadSubject batches instead of one request per managed feature", () => {
    const subject = /async function loadSubject[\s\S]*?\n}/.exec(tours)?.[0] ?? "";
    expect(subject).toMatch(/loadGlobalFeatureFlags\(/);
    // The old shape issued one isFeatureEnabled() per feature.
    expect(subject).not.toMatch(/MANAGED_FEATURES\.map\([^)]*isFeatureEnabled/);
  });

  it("there are enough managed features for the batch to matter", () => {
    // If this ever collapses to one or two, the batching is no longer the win
    // the comment claims -- better to notice than to keep asserting folklore.
    expect(MANAGED_FEATURES.length).toBeGreaterThanOrEqual(5);
  });

  it("the batched loader resolves flags by the same rule", () => {
    const batch = /export async function loadGlobalFeatureFlags[\s\S]*?\n}/.exec(flags)?.[0] ?? "";
    expect(batch).toMatch(/resolveGlobalFeatureFlag\(/);
    // An error must resolve OFF, never accidentally enable a gated feature.
    expect(batch).toMatch(/if \(error\) return new Set\(\)/);
  });

  it("the single-key loader still exists for other callers", () => {
    expect(flags).toMatch(/export async function isFeatureEnabled/);
  });
});

describe("the canonical rich loader is untouched for surfaces that render tours", () => {
  it("getReplayableTours still exists and still resolves full tours", () => {
    // The walkthrough settings page renders real tours and must keep the rich
    // projection; this tranche adds a narrow path, it does not weaken that one.
    expect(tours).toMatch(/export async function getReplayableTours/);
    const full = /export async function getReplayableTours[\s\S]*?\n}/.exec(tours)?.[0] ?? "";
    expect(full).toMatch(/loadProgress\(/);
    expect(full).toMatch(/resolve\(/);
  });
});

describe("eligibility semantics are unchanged", () => {
  // Behavioural, not source-text: the shared filter still governs both paths.
  const version = (over = {}) => ({
    id: "v1",
    slug: "welcome",
    status: "published",
    audience: "everyone",
    startsAt: null,
    endsAt: null,
    steps: [{ stepKey: "a", requiresFeatureFlag: null, entitlementKeys: [] }],
    ...over
  }) as never;

  const subject = (over = {}) => ({ plan: "free", signupAt: new Date(0).toISOString(), enabledFeatureFlags: [], ...over }) as never;

  it("a live tour with a visible step is replayable", () => {
    expect(replayableTours([version()], subject(), Date.now())).toHaveLength(1);
  });

  it("a tour whose only step is gated by a disabled flag is not", () => {
    const gated = version({ steps: [{ stepKey: "a", requiresFeatureFlag: "socialize", entitlementKeys: [] }] });
    expect(replayableTours([gated], subject(), Date.now())).toHaveLength(0);
    expect(replayableTours([gated], subject({ enabledFeatureFlags: ["socialize"] }), Date.now())).toHaveLength(1);
  });
});
