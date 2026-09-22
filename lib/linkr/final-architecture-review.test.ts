import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("final Linkr architecture review", () => {
  it("keeps the canonical 30-day pass and three-per-day rewind policy", () => {
    const service = read("lib/linkr/connection-service.ts");
    expect(service).toContain("PASS_DURATION_MS = 30 * 24 * 60 * 60 * 1000");
    expect(service).toContain('consumeRateLimit({ action: "linkr.undo"');
    expect(service).toContain("DAILY_SELF_SERVICE_PASS_REWINDS = 3");
    expect(service).toContain('workflow: "linkr_pass_reversal"');
  });

  it("uses incoming one-sided Connect only as a server-side decaying ranking nudge", () => {
    const candidates = read("lib/linkr/candidate-service.ts");
    expect(candidates).toContain('.eq("target_id", viewerId)');
    expect(candidates).toContain('.eq("action", "connect")');
    expect(candidates).toContain("privateReciprocityBoost(inboundConnectAt.get(id), nowMs)");
    expect(candidates).toContain("PRIVATE_RECIPROCITY_BOOST_MAX = 6");
    const typeBlock = candidates.slice(
      candidates.indexOf("export type LinkrCandidate"),
      candidates.indexOf("function serverReady")
    );
    expect(typeBlock).not.toContain("reciprocity");
    expect(typeBlock).not.toContain("clickedYou");
  });

  it("keeps Linkr matches separate from Muddy friendships", () => {
    const service = read("lib/linkr/connection-service.ts");
    const foundation = read("supabase/migrations/20260818130000_linkr_2_foundation.sql");
    expect(service).not.toContain('.from("friendships")');
    expect(foundation).toContain("This is NOT a friendship");
  });

  it("makes admin rewind review act on canonical linkr_actions only", () => {
    const admin = read("app/(admin)/admin/support/linkr-reversal-actions.ts");
    expect(admin).toContain('.from("linkr_actions")');
    expect(admin).not.toContain('from("discovery_passes")');
    expect(admin).not.toContain('from("friend_requests")');
    expect(admin).toContain("isBlockedEitherDirection");
  });

  it("does not route old Socialize through a second Linkr authority", () => {
    const web = read("app/(app)/actions.ts");
    const api = read("app/api/friends/request/route.ts");
    const friends = read("lib/friends/service.ts");
    const socialize = read("lib/social/socialize-mobile.ts");
    expect(web).not.toContain("sendLinkrInterest");
    expect(api).not.toContain("sendLinkrInterest");
    expect(friends).not.toContain("context_type.neq.socialize");
    expect(socialize).not.toContain("inboundLinkrInterestBoost");
  });
});
