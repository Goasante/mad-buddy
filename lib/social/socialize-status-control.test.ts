import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Socialize 2.0: the radar was replaced by a vertical discovery feed, so the
 * assertions below that pinned radar-specific markup (orbit nodes, the
 * aggregate chip, the selection ring) no longer describe the product. They are
 * removed rather than rewritten to match new markup, because a source
 * assertion that is edited until it passes tests nothing.
 *
 * The BEHAVIOUR they protected is still covered: state resolution in
 * socialize-state.test.ts, and feed ordering/filtering/privacy in
 * discovery-feed.test.ts.
 */
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("components/socialize/socialize-page.tsx");
const rendered = stripComments(page);
const css = read("app/globals.css");
const pulseCss = css.slice(
  css.indexOf("/* Socialize status control"),
  // Bounded: the radar field's rules follow, and its orbit breathing is not
  // this section's to police.
  css.indexOf("/* Socialize radar field")
);

/** The status control and its supporting line only. */
const control = page.slice(
  page.indexOf("Socializing status control"),
  page.indexOf("The radar IS the interface")
);

// ---------------------------------------------------------------------------
// State model
// ---------------------------------------------------------------------------

describe("state model", () => {
  it("derives the state from the server session, not a second boolean", () => {
    // ONE source of truth: the session the server returned, plus its expiry.
    expect(page).toContain("const isActive = session !== null && Date.parse(session.expiresAt) > nowMs;");
  });

  it("introduces no parallel on/off flag", () => {
    for (const banned of ["socializeOn", "isSocializing", "setIsActive", "const [active", "setActive("]) {
      expect(rendered, `must not hold a second flag (${banned})`).not.toContain(banned);
    }
  });

  it("only changes what it claims after the server confirms", () => {
    // setSession happens inside the ok branch; a failure leaves it untouched,
    // so the control falls back to the last confirmed state on its own.
    expect(page).toContain("if (result.ok && result.session) {");
    expect(page).toContain("setSession(result.session);");
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe("copy", () => {
  it("uses the approved active wording", () => {
    expect(control).toContain('"Linkr is on"');
    expect(control).toContain("Visible to nearby people.");
  });

  it("drops the system-style boolean wording entirely", () => {
    // Including the old badge under the avatar, which said exactly this.
    expect(rendered).not.toContain("Socialize ON");
    expect(rendered).not.toContain("Socialize OFF");
  });

  it("keeps technical permission language out of the control", () => {
    const block = stripComments(control);
    for (const banned of ["GPS", "geolocation", "coordinates", "latitude", "longitude"]) {
      expect(block, `control must not say ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Placement and appearance
// ---------------------------------------------------------------------------

describe("appearance", () => {
  it("uses a subtle green accent when active", () => {
    expect(control).toContain("border-emerald-500/35 bg-emerald-500/10");
    expect(control).toContain("bg-emerald-500");
  });

  it("shows a clear status indicator", () => {
    expect(control).toContain("h-2.5 w-2.5 rounded-full");
  });
});

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

describe("interaction", () => {
  it("routes through the existing options panel rather than activating silently", () => {
    expect(control).toContain("<Popover.Trigger asChild>");
    expect(control).toContain("{statusPanel}");
  });

  it("is the single entry point into the options panel", () => {
    // Step 3 removed the avatar trigger (no controls over the avatar), so the
    // status control is now the only anchor — one panel, rendered once.
    expect(page).toContain("const statusPanel = (");
    expect((page.match(/\{statusPanel\}/g) ?? []).length).toBe(1);
  });

  it("introduces no duplicate confirmation flow", () => {
    const block = stripComments(control);
    expect(block).not.toContain("window.confirm");
    expect(block).not.toContain("Are you sure");
    // Turn off still runs through the existing panel action.
    expect(page).toContain("onClick={turnOff}");
  });

  it("prepares the prerequisite choices before opening", () => {
    // How long / how far are gathered by the existing flow, not skipped.
    expect(page).toContain("function handleStatusOpenChange(open: boolean)");
    expect(page).toContain("setDuration(null);");
  });
});

// ---------------------------------------------------------------------------
// Loading and failure
// ---------------------------------------------------------------------------

describe("loading and failure", () => {
  it("blocks repeat taps while a change is in flight", () => {
    expect(control).toContain("disabled={isPending || activating}");
    expect(page).toContain("const busy = isPending || activating;");
  });

  it("shows compact progress rather than a full-screen spinner", () => {
    expect(control).toContain("<Loader2");
    expect(control).toContain('"Turning on…"');
    expect(rendered).not.toContain("fixed inset-0 grid place-items-center");
  });

  it("keeps the control the same size while loading", () => {
    // The spinner replaces the dot inside a fixed-size box, so nothing reflows.
    expect(control).toContain("relative grid h-4 w-4 shrink-0 place-items-center");
  });

  it("falls back to the confirmed state on failure", () => {
    // The failure branch only shows a message; it never writes session state.
    const submit = page.slice(page.indexOf("function submitSetup"), page.indexOf("function turnOff"));
    const failure = submit.slice(submit.indexOf("} else {"));
    expect(failure).toContain("showToast(");
    expect(failure).not.toContain("setSession(");
  });

  it("shows a concise message and never a raw error", () => {
    expect(page).toContain('showToast(result.message || "Couldn’t turn on Socialize. Try again.", true);');
    const block = stripComments(page);
    expect(block).not.toContain("error.stack");
    expect(block).not.toContain("JSON.stringify(error");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("says who can see you without revealing where you are", () => {
    expect(control).toContain("Visible to nearby people.");
    const block = stripComments(control);
    for (const banned of ["metres", "meters", "km", "miles", "address", "street"]) {
      expect(block, `must not expose ${banned}`).not.toContain(banned);
    }
  });

  it("links to the existing safety explanation instead of restating policy", () => {
    expect(control).toContain('href="/safety-center"');
    expect(control).toContain("How this works");
  });
});

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

describe("motion", () => {
  it("pulses once on a confirmed change, not continuously", () => {
    expect(pulseCss).toContain("animation: socialize-status-pulse 600ms ease-out 1;");
    expect(pulseCss).not.toContain("infinite");
  });

  it("only pulses after the server confirms", () => {
    // pulseStatus is called inside the ok branches, never optimistically.
    const submit = page.slice(page.indexOf("function submitSetup"), page.indexOf("function turnOff"));
    expect(submit.indexOf("pulseStatus()")).toBeGreaterThan(submit.indexOf("if (result.ok && result.session)"));
  });

  it("respects reduced motion", () => {
    const reduced = pulseCss.slice(pulseCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(control).toContain("motion-reduce:active:scale-100");
    expect(control).toContain("motion-reduce:animate-none");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("is a real button", () => {
    // A real <button> with an explicit type, not a div with a click handler.
    expect(control).toMatch(/<button\s+type="button"/);
  });

  it("announces the current state in its label", () => {
    expect(control).toContain("Linkr is on. Visible to nearby people.");
    expect(control).toContain("Linkr is off. Turn it on to meet people nearby.");
  });

  it("keeps a 44px touch target", () => {
    expect(control).toContain("min-h-[44px]");
  });

  it("keeps a visible focus ring", () => {
    expect(control).toContain("focus-ring");
  });

  it("hides the decorative indicator from assistive tech", () => {
    // The label already carries the state; the dot must not be announced too.
    expect(control).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe("step 2 scope", () => {

  it("leaves the actions untouched", () => {
    for (const action of ["activateSocializeAction", "deactivateSocializeAction", "updateSocializeAction"]) {
      expect(page, `${action} must still be used`).toContain(action);
    }
  });
});

describe("hero-owned activation", () => {
  it("says the state ONCE, in the hero CTA", () => {
    // The old layout said "Socialize is off" in a floating pill AND again in
    // the empty state beneath it — the most valuable space on the page spent
    // twice on the same fact.
    const hero = stripComments(read("components/socialize/socialize-hero.tsx"));
    expect(hero).toContain("Discover people around you");
    expect(page).toContain('"Turn On Socialize"');
    // The visible label; the aria-label still describes the state, which is
    // correct for a screen reader announcing a toggle.
    expect(page).not.toContain('> Socialize is off<');
  });

  it("leads aspirationally rather than diagnostically", () => {
    const hero = stripComments(read("components/socialize/socialize-hero.tsx"));
    expect(hero).not.toContain("is off");
    // "disabled" appears only as a React prop, never as user-facing copy.
    expect(hero).not.toContain("Feature disabled");
  });

  it("keeps the activation flow in the existing popover", () => {
    // The CTA is the popover's trigger, so activation still runs the
    // prerequisite flow rather than a second silent path.
    expect(page).toContain("activationTrigger={");
    expect(page).toContain("TOUR_TARGET_IDS.SOCIALIZE_ACTIVATION");
  });
});
