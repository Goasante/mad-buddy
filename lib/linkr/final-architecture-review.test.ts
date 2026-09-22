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

  it("makes a temporary pass a private pair-wide 30-day breathing room", () => {
    const candidates = read("lib/linkr/candidate-service.ts");
    const service = read("lib/linkr/connection-service.ts");
    expect(candidates).toContain("inboundPassedIds");
    expect(candidates).toContain("if (inboundPassedIds.has(id)) continue");
    expect(service).toContain("reciprocalPass");
    expect(service).toContain('.eq("actor_id", targetId)');
    expect(service).toContain('.eq("target_id", viewerId)');
    expect(service).toContain("Do not mutate the target's own private Connect row here");
    expect(service).not.toContain('delete()\n    .eq("actor_id", targetId)\n    .eq("target_id", viewerId)\n    .eq("action", "connect")');
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

  it("requires an explicit Ask support action after the three self-service rewinds", () => {
    const service = read("lib/linkr/connection-service.ts");
    const page = read("components/linkr/linkr-page.tsx");
    const card = read("components/linkr/candidate-card.tsx");
    expect(service).toContain('code: "review_available"');
    expect(service).toContain("requestLinkrPassReversalReview");
    expect(page).toContain("requestLinkrPassReversalReviewAction");
    expect(page).toContain("setReviewTargetId(result.reviewTargetId)");
    expect(card).toContain("Ask support");
  });

  it("only exposes Undo pass after a Pass, not after a one-sided Connect", () => {
    const page = read("components/linkr/linkr-page.tsx");
    expect(page).toContain("advance(true);\n    void passCandidateAction");
    expect(page).toContain("advance(false);\n    void connectWithCandidateAction");
  });

  it("marks an admin rewind review complete in the client after success", () => {
    const review = read("components/admin/support/linkr-reversal-review.tsx");
    expect(review).toContain("const [isReviewed, setIsReviewed] = useState(reviewed)");
    expect(review).toContain("if (result.ok) setIsReviewed(true)");
    expect(review).toContain("{!isReviewed ? (");
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
