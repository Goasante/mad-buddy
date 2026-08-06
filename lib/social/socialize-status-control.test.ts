import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("never infers state from colour, presence, glow or permission", () => {
    const block = stripComments(control);
    for (const banned of ["glow", "presence", "permission", "navigator.geolocation"]) {
      expect(block, `must not infer state from ${banned}`).not.toContain(banned);
    }
    // The control reads isActive and nothing else.
    expect(block).toContain("isActive");
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
    expect(control).toContain('"Socializing"');
    expect(control).toContain("Visible to nearby people.");
  });

  it("uses the approved inactive wording", () => {
    expect(control).toContain('"Socialize is off"');
    expect(control).toContain("Turn it on to meet people nearby.");
  });

  it("drops the system-style boolean wording entirely", () => {
    // Including the old badge under the avatar, which said exactly this.
    expect(rendered).not.toContain("Socialize ON");
    expect(rendered).not.toContain("Socialize OFF");
  });

  it("states the state once, so two labels cannot disagree", () => {
    // One rendered label for each state. ("Socialize is off" also appears as
    // the toast confirming the change, which is a different surface.)
    expect((stripComments(control).match(/"Socializing"/g) ?? []).length).toBe(1);
    expect((stripComments(control).match(/"Socialize is off"/g) ?? []).length).toBe(1);
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

describe("placement", () => {
  it("sits between the intro and the radar", () => {
    expect(page.indexOf("Meet people nearby who are open to connecting.")).toBeLessThan(
      page.indexOf("Socializing status control")
    );
    expect(page.indexOf("Socializing status control")).toBeLessThan(page.indexOf("The radar IS the interface"));
  });

  it("is not placed over the user avatar", () => {
    // The old label was absolutely positioned under the avatar; this one is
    // in normal flow above the radar.
    expect(control).toContain("mx-auto mt-4 flex");
    expect(control).not.toContain("absolute left-1/2 top-full");
  });

  it("reads as a control rather than a decorative badge", () => {
    expect(control).toContain("<button");
    expect(control).toContain("rounded-full border");
  });
});

describe("appearance", () => {
  it("uses a subtle green accent when active", () => {
    expect(control).toContain("border-emerald-500/35 bg-emerald-500/10");
    expect(control).toContain("bg-emerald-500");
  });

  it("uses a neutral surface when inactive, never alarming red", () => {
    expect(control).toContain("border-border/60 bg-secondary/50");
    const block = stripComments(control);
    expect(block).not.toContain("red-");
    expect(block).not.toContain("destructive");
  });

  it("stays restrained — no neon and no oversized capsule", () => {
    expect(control).toContain("px-4 py-2");
    // A small dot glow only; no large capsule shadow.
    expect(control).not.toContain("shadow-[0_0_46px");
    expect(control).not.toContain("bg-gradient-to-r");
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
    expect(control).toContain("Socializing is on. Visible to nearby people.");
    expect(control).toContain("Socializing is off. Activate to meet people nearby.");
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
  it("leaves the header and intro untouched", () => {
    expect(page).toContain("Meet people nearby who are open to connecting.");
    expect(page).toContain('<h1 className="text-[1.75rem] font-bold leading-none tracking-tight">Socialize</h1>');
  });

  it("leaves the radar surface in place", () => {
    // Step 3 rebuilt the radar's geometry (computeRadarLayout → the identity
    // -based buildRadarField), so this now asserts the radar still EXISTS and
    // renders people — its internals are covered by radar-layout.test.ts.
    expect(page).toContain("TOUR_TARGET_IDS.SOCIALIZE_RADAR");
    expect(page).toContain("buildRadarField");
  });

  it("leaves the actions untouched", () => {
    for (const action of ["activateSocializeAction", "deactivateSocializeAction", "updateSocializeAction"]) {
      expect(page, `${action} must still be used`).toContain(action);
    }
  });
});
