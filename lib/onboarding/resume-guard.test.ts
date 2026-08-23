import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Unfinished onboarding must resume, from ANY entry into the app.
 *
 * MB-GOD-049: onboarding was reachable from exactly one place — the signup
 * action returning `redirectTo: "/onboarding"`. The login action never looked
 * at `is_onboarded`; it returns `safeAuthNext(next)`, whose fallback is
 * `POST_LOGIN_ROUTE` (/friends). So anyone who arrived by logging in rather
 * than by completing signup walked straight past onboarding and into the
 * product with an empty display name and a machine-generated username
 * (`user_02748448`) — which is how every other member would then see them.
 *
 * That path is real, not hypothetical: `app/(auth)/actions.ts` handles a failed
 * auto-signin by returning the person to /login with "Account created. Log in
 * to continue.", commenting that "nobody is stranded".
 *
 * The guard lives in the (app) layout rather than the login action because that
 * layout wraps EVERY authenticated route. A deep link, a shared Plan URL, a
 * restored PWA session and an OAuth callback all pass through it, and each was
 * a separate way around a login-only check.
 */

const ROOT = join(__dirname, "..", "..");
const layout = readFileSync(join(ROOT, "app/(app)/layout.tsx"), "utf8");

describe("onboarding resume guard", () => {
  it("the app layout redirects an un-onboarded account to /onboarding", () => {
    expect(layout).toContain('redirect("/onboarding")');
  });

  it("gates on is_onboarded === false, never on a falsy check", () => {
    /* `!profile.is_onboarded` would also fire on null/undefined — including a
       missing profile row, which is NOT reachable through signup and would
       bounce accounts created by other means into a loop. The explicit
       comparison is the whole safety of this guard. */
    expect(layout).toMatch(/is_onboarded === false/);
    expect(layout).not.toMatch(/!\s*profileResult\.data\.is_onboarded/);
  });

  it("only redirects when a profile row actually exists", () => {
    const guard = layout.slice(
      Math.max(0, layout.indexOf("MB-GOD-049")),
      layout.indexOf('redirect("/onboarding")') + 40
    );
    expect(guard, "the guard must require profileResult.data").toContain("profileResult.data &&");
  });

  it("selects is_onboarded in the layout's own profile query", () => {
    // A guard reading a column the query never fetched is always undefined,
    // which the `=== false` comparison would silently turn into "no redirect".
    /* Sliced FORWARD from the profiles query, not to the first
       `.eq("user_id", ...)` in the file — several earlier queries use that
       same filter, so an index-of pair produced an empty string and the
       assertion passed on nothing. */
    const start = layout.indexOf('.from("profiles")');
    expect(start, "the layout no longer queries profiles").toBeGreaterThan(-1);
    const select = layout.slice(start, start + 500);
    expect(select).toContain("is_onboarded");
  });

  it("still lets /onboarding send a completed profile back out", () => {
    /* The two halves have to agree or an existing member loops forever:
       the layout sends `is_onboarded === false` to /onboarding, and
       /onboarding sends an already-onboarded profile straight back. */
    const onboarding = readFileSync(join(ROOT, "app/(onboarding)/onboarding/page.tsx"), "utf8");
    expect(onboarding).toContain("if (profile?.is_onboarded)");
    expect(onboarding).toContain("redirect(POST_LOGIN_ROUTE)");
    // And the self-heal for a stranded-but-complete profile must survive.
    expect(onboarding).toContain("recoverOnboardingIfStranded");
  });
});
