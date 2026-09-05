import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * /api/profile request de-amplification contract.
 *
 * Measured on staging: a warm Profile GET cost ~1197ms server-side, dominated
 * by identity (~1149ms) and journey (~1122ms) -- and journey was almost
 * entirely its own Buddy Score load. Identity and Journey each called
 * loadBuddyScore independently, and loadBuddyScore reconciles, so ONE
 * presentation GET performed:
 *
 *   2 reconciliations x (7 parallel queries + auth.admin.getUserById
 *                        + conditional plans read + ledger UPSERT)
 *
 * A presentation GET must not mutate score state. These tests hold that line
 * in both directions: the score is resolved once, read-only, and shared.
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

const profileRoute = codeOf(read("app/api/profile/route.ts"));
const identityService = codeOf(read("lib/profile/identity-service.ts"));
const journeyService = codeOf(read("lib/journey/journey-service.ts"));
const scoreService = codeOf(read("lib/engagement/buddy-score-service.ts"));

describe("the Profile GET resolves one read-only score", () => {
  it("uses the read-only snapshot, not the reconciling loader", () => {
    expect(profileRoute).toMatch(/readBuddyScoreSnapshot\s*\(/);
    expect(profileRoute).not.toMatch(/\bloadBuddyScore\s*\(/);
  });

  it("never reconciles on the presentation path", () => {
    // Reconciliation is a WRITE. A GET that renders a profile must not perform
    // one, let alone two.
    expect(profileRoute).not.toMatch(/reconcileBuddyScore/);
  });

  it("resolves the snapshot exactly once", () => {
    const calls = profileRoute.match(/readBuddyScoreSnapshot\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("shares that one score with BOTH consumers", () => {
    // If either consumer is left without context it silently loads its own,
    // which is exactly the defect this tranche removes.
    // Matches `{ score }` and `{ score, ... }` alike: the contract is that the
    // one resolved score reaches both consumers, not that it travels alone.
    expect(profileRoute).toMatch(/loadProfileIdentitySummary\([^;]*\{\s*score\b[^;]*\}\s*\)/);
    expect(profileRoute).toMatch(/loadJourney\([^;]*\{\s*score\b[^;]*\}\s*\)/);
  });
});

describe("consumers honour preloaded score context", () => {
  it("identity skips its own load when context supplies a score", () => {
    expect(identityService).toMatch(/context\.score/);
    expect(identityService).toMatch(/context\.score[\s\S]*?\?[\s\S]*?Promise\.resolve\(context\.score\)/);
  });

  it("journey skips its own load when context supplies a score", () => {
    expect(journeyService).toMatch(/context\.score\s*\?\s*Promise\.resolve\(context\.score\)/);
  });

  it("both still load independently when no context is given", () => {
    // Backward compatibility: other callers must keep working unchanged.
    expect(identityService).toMatch(/loadBuddyScore\(admin, userId\)/);
    expect(journeyService).toMatch(/loadBuddyScore\(admin, userId\)/);
  });
});

describe("the read-only snapshot is genuinely read-only", () => {
  const snapshot = /export async function readBuddyScoreSnapshot[\s\S]*?\n}/.exec(scoreService)?.[0] ?? "";

  it("exists", () => {
    expect(snapshot).not.toBe("");
  });

  it("performs no write and no reconciliation", () => {
    expect(snapshot).not.toMatch(/reconcileBuddyScore/);
    expect(snapshot).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("performs no admin auth lookup", () => {
    // reconcileBuddyScore's auth.admin.getUserById was pure cost on a GET.
    expect(snapshot).not.toMatch(/auth\.admin/);
  });

  it("reads the ledger", () => {
    expect(snapshot).toMatch(/buddy_score_ledger/);
  });
});

describe("canonical reconciliation is preserved elsewhere", () => {
  it("loadBuddyScore still reconciles for the canonical surface", () => {
    // Progression must still become current somewhere: /buddy-score and
    // /api/buddy-score go through loadMyProgress -> loadBuddyScore.
    expect(scoreService).toMatch(/export async function loadBuddyScore[\s\S]*?reconcileBuddyScore\(admin, userId\)/);
  });

  it("the canonical progress surface still calls the reconciling loader", () => {
    const progress = codeOf(read("lib/progress/my-progress-service.ts"));
    expect(progress).toMatch(/loadBuddyScore\(admin, userId\)/);
  });

  it("reconcileBuddyScore remains exported for deliberate callers", () => {
    expect(scoreService).toMatch(/export async function reconcileBuddyScore/);
  });
});
