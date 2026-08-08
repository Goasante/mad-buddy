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

/**
 * The activation control only.
 *
 * Sliced from the hero's trigger prop to the end of the visibility note it
 * carries, so these assertions describe the control rather than the page.
 */
const control = page.slice(
  page.indexOf("activationTrigger={"),
  page.indexOf("/>", page.indexOf("visibilityNote={"))
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
  it("uses one name for the experience", () => {
    // "Turn On Socialize" and "Discover Nearby" were two labels for entering
    // the same thing, which asked the user to tell apart something that was
    // never different. One name, one control.
    expect(control).toContain('"Discover Nearby"');
    expect(control).not.toContain("Turn On Socialize");
  });

  it("states the live condition rather than naming a setting", () => {
    // "You're discoverable" says what is true of the user; "Linkr is on" says
    // what is true of a toggle.
    expect(control).toContain("You're discoverable");
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
  it("recedes once live, so the people become the call to action", () => {
    // Off, the button IS the call to action. On, it is a status the user
    // occasionally revisits — a second loud CTA competes with the feed.
    expect(control).toContain("linkr-discover-cta-live");
    const live = css.slice(css.indexOf(".linkr-discover-cta-live {"));
    expect(live.slice(0, 400)).toContain("hsl(var(--card)");
  });

  it("shows state in the icon, not only the label", () => {
    expect(control).toContain("<Pause");
    expect(control).toContain("<Play");
  });
});

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

describe("interaction", () => {
  it("activates in one tap, with no setup form first", () => {
    // Asking "how long?" and "how far?" before anyone had seen a single person
    // made a form the price of looking. Both are changeable afterwards.
    expect(page).toContain("function startDiscovering()");
    expect(control).toContain("onClick={isActive ? turnOff : startDiscovering}");
  });

  it("is one control with two states, not two controls", () => {
    // The same button starts and pauses, so the two can never disagree about
    // whether the user is discoverable.
    expect(control).toContain("aria-pressed={isActive}");
    expect((page.match(/activationTrigger=\{/g) ?? []).length).toBe(1);
  });

  it("still expires the session rather than leaving visibility on forever", () => {
    // Removing the duration QUESTION must not remove the duration. Visibility
    // that never lapses is one the user forgot they left on.
    expect(page).toContain("const DEFAULT_DISCOVER_DURATION: SocializeDuration");
    expect(page).toContain("duration: DEFAULT_DISCOVER_DURATION");
  });

  it("keeps reach adjustable, because it decides who can see you", () => {
    expect(page).toContain("function selectReach(");
    expect(page).toContain("linkr-segmented");
  });

  it("introduces no duplicate confirmation flow", () => {
    const block = stripComments(control);
    expect(block).not.toContain("window.confirm");
    expect(block).not.toContain("Are you sure");
    // Pausing runs through the existing deactivate action.
    expect(page).toContain("function turnOff()");
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
    expect(control).toContain('"Starting…"');
    expect(rendered).not.toContain("fixed inset-0 grid place-items-center");
  });

  it("keeps the control the same size while loading", () => {
    // The spinner replaces the glyph inside a fixed-size box, so nothing
    // reflows mid-activation.
    expect(control).toContain("linkr-discover-icon");
    const icon = css.slice(css.indexOf(".linkr-discover-icon {"));
    expect(icon.slice(0, 300)).toContain("height: 1.75rem");
  });

  it("falls back to the confirmed state on failure", () => {
    // The failure branch only shows a message; it never writes session state.
    const start = page.slice(page.indexOf("function startDiscovering"), page.indexOf("function turnOff"));
    const failure = start.slice(start.indexOf("} else {"));
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
    // Motion moved into the control's own class, disabled wholesale under
    // prefers-reduced-motion rather than per-utility.
    const cta = css.slice(css.indexOf(".linkr-discover-cta {"));
    expect(cta.slice(0, 2600)).toContain("prefers-reduced-motion");
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
    // The label states what the next press DOES, plus the current condition.
    expect(control).toContain("Pause Discover Nearby. You are currently visible to nearby people.");
    expect(control).toContain("Start Discover Nearby. You will become visible to nearby people.");
  });

  it("keeps a 44px touch target", () => {
    // 48px, set on the control's own class.
    const cta = css.slice(css.indexOf(".linkr-discover-cta {"));
    expect(cta.slice(0, 400)).toContain("min-height: 3rem");
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
    expect(page).toContain('"Discover Nearby"');
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
