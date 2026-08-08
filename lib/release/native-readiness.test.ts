import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const app = stripComments(read("mobile/src/App.tsx"));
const authProvider = stripComments(read("mobile/src/auth/AuthProvider.tsx"));
const signup = stripComments(read("mobile/src/screens/SignupScreen.tsx"));
const onboarding = stripComments(read("mobile/src/screens/OnboardingScreen.tsx"));
const css = read("app/globals.css");
const layout = read("app/layout.tsx");

// ---------------------------------------------------------------------------
// Onboarding cannot be bypassed
// ---------------------------------------------------------------------------

describe("native routing reads onboarding state, not just a session", () => {
  it("resolves is_onboarded from the profile", () => {
    // A session proves someone signed in; it says nothing about whether they
    // finished setting up.
    expect(authProvider).toContain('.select("is_onboarded")');
    expect(authProvider).toContain('.from("profiles")');
  });

  it("fails closed when the profile is missing or unreadable", () => {
    // A fresh OAuth user, or one whose provisioning did not finish, has no
    // profile row. Assuming completion would strand them on a Home screen
    // built from a profile that does not exist.
    expect(authProvider).toContain("setIsOnboarded(error ? false : Boolean(data?.is_onboarded))");
  });

  it("treats unresolved state as still loading", () => {
    // Routing before it resolves would flash the wrong screen every cold start.
    expect(authProvider).toContain("loading: loading || (Boolean(userId) && isOnboarded === null)");
  });

  it("sends an unfinished user to onboarding from the app guard", () => {
    const guard = app.slice(app.indexOf("function RequireAuth("));
    expect(guard.slice(0, 500)).toContain('if (!isOnboarded) return <Navigate to="/onboarding" replace />');
  });

  it("sends an unfinished user to onboarding from the signed-in guard too", () => {
    // Opening /login while signed in used to land on Home unconditionally,
    // which is how onboarding was bypassed by reopening the app.
    const guard = app.slice(app.indexOf("function RedirectIfAuthed("));
    expect(guard.slice(0, 500)).toContain('isOnboarded ? "/home" : "/onboarding"');
  });

  it("keeps the onboarding screen itself reachable", () => {
    // Guarding it with RequireAuth would redirect it to itself forever.
    expect(app).toContain("RequireAuthPreOnboarding");
    expect(app).toContain(
      '<Route path="/onboarding" element={<RequireAuthPreOnboarding><OnboardingScreen /></RequireAuthPreOnboarding>} />'
    );
  });

  it("stops a finished user from re-entering onboarding", () => {
    const guard = app.slice(app.indexOf("function RequireAuthPreOnboarding("));
    expect(guard.slice(0, 500)).toContain('if (isOnboarded) return <Navigate to="/home" replace />');
  });

  it("refreshes state before leaving onboarding", () => {
    // Navigating on stale state would be bounced straight back by a guard that
    // has not yet seen the write that just succeeded.
    expect(onboarding).toContain("await refreshOnboarding()");
    const complete = onboarding.slice(onboarding.indexOf("await refreshOnboarding()"));
    expect(complete.slice(0, 200)).toContain('navigate("/home"');
  });
});

// ---------------------------------------------------------------------------
// Legal documents are reachable before consent
// ---------------------------------------------------------------------------

describe("native legal documents are real, reachable links", () => {
  it("routes both documents", () => {
    expect(app).toContain('<Route path="/privacy" element={<PrivacyScreen />} />');
    expect(app).toContain('<Route path="/terms" element={<TermsScreen />} />');
  });

  it("leaves them unguarded, so they can be read before signing up", () => {
    // Consent is given AT signup. A document you can only read after agreeing
    // to it is not a document you agreed to.
    const privacyRoute = app.slice(app.indexOf('path="/privacy"'));
    expect(privacyRoute.slice(0, 120)).not.toContain("RequireAuth");
  });

  it("uses anchors on the signup consent line, not styled spans", () => {
    // The spans looked like links and could not be opened, so consent was
    // being asked for documents the user had no way to read.
    const consent = signup.slice(signup.indexOf("I agree to the"));
    expect(consent.slice(0, 700)).toContain('<Link');
    expect(consent.slice(0, 700)).toContain('to="/terms"');
    expect(consent.slice(0, 700)).toContain('to="/privacy"');
  });

  it("renders the same content modules the web pages use", () => {
    // Two copies of a legal document is two documents that will eventually
    // disagree, and which one a user accepted would depend on their build.
    const legal = stripComments(read("mobile/src/screens/LegalScreen.tsx"));
    expect(legal).toContain('from "@/content/privacy-policy"');
    expect(legal).toContain('from "@/content/terms"');
  });

  it("keeps the web terms page on that same shared module", () => {
    const terms = stripComments(read("app/terms/page.tsx"));
    expect(terms).toContain('from "@/content/terms"');
  });
});

// ---------------------------------------------------------------------------
// Landing content survives without JavaScript
// ---------------------------------------------------------------------------

describe("landing content is visible before hydration", () => {
  it("marks the document as JS-capable before first paint", () => {
    expect(layout).toContain("document.documentElement.classList.add('js')");
  });

  it("sets that marker outside the try block", () => {
    // localStorage throws in some privacy modes. If that exception skipped the
    // marker, the landing page would stay blank for exactly the
    // privacy-conscious users this product is built for.
    const script = layout.slice(layout.indexOf("const themeScript"));
    const marker = script.indexOf("classList.add('js')");
    const tryStart = script.indexOf("try {");
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(tryStart);
  });

  it("hides reveal elements only when JavaScript is running", () => {
    // Whitespace-normalised so multi-line selectors are matched whole -- a
    // per-line check misses `.moment-story .moment-step,` style groups.
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
    const ungated: string[] = [];

    for (const match of flat.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = match[1].trim();
      const body = match[2];
      if (!/opacity:\s*0(;|\s|$)/.test(body)) continue;
      if (!/reveal|moment-step|moment-benefit|moment-trust|moment-cta/.test(selector)) continue;
      if (selector.includes(":root.js")) continue;
      ungated.push(selector);
    }

    expect(ungated, `these hide content without a JS gate: ${ungated.join(" | ")}`).toEqual([]);
  });

  it("still animates when JavaScript is available", () => {
    // The fix must not silently delete the animation it was protecting.
    expect(css).toContain(":root.js .landing-reveal.is-visible");
  });
});
