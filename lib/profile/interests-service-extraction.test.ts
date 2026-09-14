import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Profile interests, extracted so both platforms run one implementation.
 *
 * Second of the four Profile extractions (photos was #92). Android cannot call
 * a Server Action, so sharing the interests card needs a REST route — and a
 * route that reimplemented the save would be a second place for the closed
 * taxonomy check and the add-before-remove ordering to drift.
 */

const read = (p: string) => readFileSync(p, "utf8");
const service = read("lib/profile/interests-service.ts");
const action = read("app/(app)/profile-interests-actions.ts");
const route = read("app/api/profile/interests/route.ts");

describe("there is one implementation, not two", () => {
  it("the Server Action delegates rather than duplicating", () => {
    expect(action).toContain("setProfileInterests(createSupabaseAdminClient()");
    expect(action).toContain('from "@/lib/profile/interests-service"');
  });

  it("the route calls the SAME service", () => {
    expect(route).toContain('from "@/lib/profile/interests-service"');
    expect(route).toContain("setProfileInterests(createSupabaseAdminClient()");
  });

  it("the action keeps no copy of the behaviour it delegated", () => {
    expect(action).not.toContain("validateInterestSelection");
    expect(action).not.toContain("diffInterests");
    expect(action).not.toContain('.from("user_interests")');
  });
});

describe("the validation moved intact", () => {
  it("still checks the closed taxonomy on the server", () => {
    // The picker only offers canonical values, but the picker is not what
    // protects this: an arbitrary string would become display text.
    expect(service).toContain("validateInterestSelection(parsed.data.interests)");
    expect(service).toContain("if (!selection.ok) return");
  });

  it("keeps the input bounds the action had", () => {
    /* MOVED VERBATIM. A first draft of this extraction relaxed the schema to
       z.array(z.string()).max(64) — dropping the per-string cap entirely. The
       line-by-line diff against the original caught it. */
    expect(service).toContain("z.array(z.string().max(60)).max(MAX_INTERESTS * 4)");
  });

  it("writes the validated output, never the raw request", () => {
    expect(service).toContain("diffInterests(current, selection.interests)");
  });

  it("scopes every statement to the caller's own rows", () => {
    expect(service).toContain('.eq("user_id", userId)');
    expect(service).not.toMatch(/input\.userId|parsed\.data\.userId|targetUserId/);
  });

  it("adds before it removes, so a failed save cannot empty a profile", () => {
    // Adding first leaves a superset of what was chosen, recoverable by saving
    // again. Deleting first could lose interests the person still wanted.
    const insert = service.indexOf(".insert(");
    const remove = service.indexOf(".delete()");
    expect(insert).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(insert);
  });
});

describe("the service does no authentication of its own", () => {
  it("takes the admin client and a proven userId", () => {
    expect(service).toContain("admin: Admin,");
    expect(service).toContain("userId: string,");
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

  it("uses PUT, because the body is the whole selection", () => {
    // The service diffs it against what is stored and applies the difference.
    expect(route).toContain("export async function PUT");
  });
});
