import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Trusted Member applications, extracted so both platforms run one
 * implementation.
 *
 * Third of the four Profile extractions (photos #92, interests #93). The badge
 * is APPLIED FOR, never granted automatically: meeting the bar earns the right
 * to ask, and a human still decides. A second implementation of "may this
 * person apply" is exactly how that gap gets closed by accident.
 */

const read = (p: string) => readFileSync(p, "utf8");
const service = read("lib/trust/application-service.ts");
const action = read("app/(app)/trusted-member-actions.ts");
const route = read("app/api/trust/apply/route.ts");

describe("there is one implementation, not two", () => {
  it("both Server Actions delegate rather than duplicating", () => {
    expect(action).toContain("getTrustedMemberStanding(createSupabaseAdminClient()");
    expect(action).toContain("applyForTrustedMember(createSupabaseAdminClient()");
    expect(action).toContain('from "@/lib/trust/application-service"');
  });

  it("the route calls the SAME service", () => {
    expect(route).toContain('from "@/lib/trust/application-service"');
    expect(route).toContain("getTrustedMemberStanding(createSupabaseAdminClient()");
    expect(route).toContain("applyForTrustedMember(createSupabaseAdminClient()");
  });

  it("the action keeps no copy of the behaviour it delegated", () => {
    expect(action).not.toContain("trustedMemberEligibility");
    expect(action).not.toContain("premiumDaysSince");
    expect(action).not.toContain("consumeRateLimit");
    expect(action).not.toContain('.from("trusted_member_applications")');
    // 164 lines before the move; a delegating action is a fraction of that.
    expect(action.split("\n").length).toBeLessThan(110);
  });
});

describe("the eligibility rules moved intact", () => {
  it("recomputes standing at submit, never trusting the caller", () => {
    // The page that offered the Apply button may be an hour stale.
    expect(service).toContain("const standing = await getTrustedMemberStanding(admin, userId)");
    expect(service).not.toMatch(/input\.(canApply|eligible)|parsed\.data\.(canApply|eligible)/);
  });

  it("counts tenure only while the subscription is active", () => {
    // A cancelled subscriber must not keep earning standing they no longer
    // pay for.
    expect(service).toContain('subscription.status === "active"');
  });

  it("rate limits applications", () => {
    expect(service).toContain('consumeRateLimit({ action: "trusted_member.apply", userId })');
  });

  it("refuses with the reason, not a blanket no", () => {
    // "Already being reviewed" and "not eligible yet" are different things to
    // tell someone, and only one of them is worth waiting on.
    expect(service).toContain("Your application is already being reviewed.");
    expect(service).toContain("You're already a Trusted Member.");
    expect(service).toContain("You're not eligible to apply yet.");
  });

  it("upserts, so re-applying updates rather than queueing twice", () => {
    // The queue is a queue, not a way to ask louder.
    expect(service).toContain('{ onConflict: "user_id" }');
  });

  it("captures the numbers the application was judged on", () => {
    // A reviewer weeks later must see what this person qualified on; an
    // approval has to stay explicable after the numbers have moved.
    expect(service).toContain("premium_days_at_apply: standing.premiumDays");
    expect(service).toContain("journeys_complete_at_apply: standing.journeysComplete");
  });

  it("clears the previous decision on re-application", () => {
    // Otherwise a fresh request carries a stale reviewer and note.
    expect(service).toContain("reviewed_by: null");
    expect(service).toContain("reviewed_at: null");
    expect(service).toContain("review_note: null");
  });

  it("reads only the caller's own rows", () => {
    expect(service).toContain('.eq("user_id", userId)');
    expect(service).not.toMatch(/input\.userId|parsed\.data\.userId|targetUserId/);
  });
});

describe("the service does no authentication of its own", () => {
  it("takes the admin client and a proven userId", () => {
    expect(service).toContain("admin: Admin,");
    expect(service).toContain("userId: string");
    expect(service).not.toContain("createSupabaseServerClient");
    expect(service).not.toContain("auth.getUser()");
  });

  it("leaves revalidation to the Next caller", () => {
    expect(service).not.toContain("revalidatePath");
    expect(action).toContain('revalidatePath("/profile")');
  });

  it("is server-only, so it can never reach a browser bundle", () => {
    expect(service.startsWith('import "server-only"')).toBe(true);
  });
});

describe("the route authenticates the other transport", () => {
  it("resolves a Bearer token and refuses without one", () => {
    expect(route).toContain("resolveApiUser(request)");
    expect(route).toContain('{ error: "Authentication required." }, { status: 401 }');
  });

  it("answers CORS preflight, which a cross-origin Bearer request needs", () => {
    expect(route).toContain("preflightResponse(request)");
    expect(route).toContain("withCors(");
  });

  it("exposes only GET and POST, both verbs the client can send", () => {
    // PR #93's lesson: a verb with no CORS entry or no api helper is an
    // endpoint the native app cannot reach, and neither failure shows
    // server-side.
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function PUT");
    expect(route).not.toContain("export async function PATCH");
  });

  it("cannot be asked about anyone else", () => {
    // The userId comes from the proven session, never from the request.
    expect(route).toContain("auth.user.id");
    expect(route).not.toMatch(/searchParams\.get\(["']userId/);
  });
});
