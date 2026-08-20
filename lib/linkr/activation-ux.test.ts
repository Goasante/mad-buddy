import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { missingProfileRequirements, resolveActivationRequirements } from "@/lib/linkr/rules";

/**
 * Activation asks ONE question: do you want to be open to meeting new people,
 * and what kind of connection are you looking for?
 *
 * It collects no identity at all. The history behind that is worth keeping:
 *
 *   L2  "Add a main photo" was drawn in destructive red through role="alert",
 *       so somebody who had done nothing wrong was told something had failed.
 *   L3  "Add your date of birth" was a paragraph -- untappable, with Continue
 *       permanently disabled and no way forward.
 *   L4  Both controls were removed entirely. Profile owns identity; Linkr
 *       reads it. A screen that does not collect a thing cannot collect it
 *       badly.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const activation = read("components/linkr/linkr-activation.tsx");
const orb = read("components/linkr/linkr-orb.tsx");
const page = read("components/linkr/linkr-page.tsx");
const editor = read("components/linkr/linkr-profile-editor.tsx");
const css = read("app/globals.css");
const rules = read("lib/linkr/rules.ts");

describe("activation collects NO identity", () => {
  it("has no file input, camera input or photo uploader", () => {
    expect(activation).not.toMatch(/type="file"/);
    expect(activation).not.toMatch(/capture=/);
    expect(activation).not.toMatch(/accept="image/);
    expect(activation).not.toContain("Add a photo");
    expect(activation).not.toContain("Use my profile photo");
  });

  it("has no date input or date-of-birth entry", () => {
    expect(activation).not.toMatch(/type="date"/);
    expect(activation).not.toContain("linkr-dob");
    expect(activation).not.toMatch(/Add your date of birth/);
  });

  it("has no identity form of any kind", () => {
    // The only inputs left are the intent radios, which are buttons.
    expect(activation).not.toMatch(/<input(?![^>]*type="hidden")/);
    expect(activation).not.toContain("<textarea");
  });

  it("keeps only artwork, consent, intent and the CTA", () => {
    expect(activation).toContain("LinkrOrb");
    expect(activation).toContain("activationPoints");
    expect(activation).toContain("LINKR_INTENTS");
    expect(activation).toContain("LINKR_COPY.turnOn");
    expect(activation).toContain("activationFootnote");
  });

  it("does not ask for bio, interests or discovery preferences either", () => {
    // Those belong to Your Linkr Profile, after activation.
    expect(activation).not.toContain("About me");
    expect(activation).not.toContain("Add an interest");
    expect(activation).not.toContain("Discovery distance");
  });
});

describe("missing identity hands off to Profile", () => {
  it("sends the person to Profile rather than growing a control", () => {
    expect(activation).toContain("onCompleteProfile");
    expect(rules).toContain("LINKR_PROFILE_HANDOFF_CTA");
    expect(rules).toContain("Complete profile");
  });

  it("uses ONE message and ONE destination however much is missing", () => {
    /**
     * A photo and a date of birth both live in Profile, so two prompts would
     * send somebody to the same screen twice.
     */
    const both = resolveActivationRequirements({ age: null, hasPrimaryPhoto: false });
    expect(both.profileMessage).toBe(
      "Add a profile photo and your date of birth in your profile before using Linkr."
    );
    expect(both.canActivate).toBe(false);
  });

  it("lays the handoff out as a heading above its message", () => {
    // Rendered inline, the two ran together as one sentence.
    expect(css).toMatch(/\.linkr-handoff__text \{[\s\S]*?flex-direction: column/);
    expect(css).toMatch(/\.linkr-handoff \{[\s\S]*?align-items: flex-start/);
  });

  it("deep-links into the identity section, not the top of Profile", () => {
    /* THIS TEST USED TO PASS AGAINST A BROKEN HANDOFF.
     *
     * It asserted the literal string "/profile?section=identity" -- which
     * Linkr really did push, and which Profile ignored completely: that page
     * read only its two birthday preview flags, so `section` did nothing and
     * there was no return parameter at all. The person arrived on a generic
     * Profile page with no route back to the activation they were half-way
     * through, and this test called that a deep link.
     *
     * Asserting on the shared builder instead ties the test to the contract
     * both ends implement, so the destination cannot quietly stop honouring
     * it. lib/navigation/handoff.test.ts covers the validation itself. */
    expect(page).toContain("profileHandoffHref({");
    expect(page).toContain('section: "identity"');
    expect(page).toContain('origin: "linkr"');
    // And the return path must be carried, not left to chance.
    expect(page).toContain("returnTo");
  });

  it("returns to the Event's Linkr when the trip started in Event Mode", () => {
    /* Somebody sent to Profile from Event Mode must come back to THAT Event's
     * Linkr, not the general one -- returning to a different context is its
     * own way of losing what they were doing. */
    expect(page).toContain('if (eventId) returnParams.set("eventId", eventId)');
  });

  it("keeps the chosen intent across the Profile round trip", () => {
    expect(activation).toContain("initialIntent");
    expect(activation).toContain("onCompleteProfile(intent)");
    expect(page).toContain('if (intent) returnParams.set("intent", intent)');
    expect(page).toContain("initialIntent={pendingIntent ?? profile?.intent");
  });

  it("still treats the photo as genuinely required by the SERVER", () => {
    // The collection moved; the rule did not.
    expect(missingProfileRequirements({ age: 24, hasPrimaryPhoto: false })).toEqual([
      "Add a main photo"
    ]);
    expect(missingProfileRequirements({ age: 24, hasPrimaryPhoto: true })).toEqual([]);
  });
});

describe("Continue gating is explained", () => {
  it("offers the Profile CTA instead of a dead disabled button", () => {
    // The failure mode this replaces: a disabled Continue and no idea why.
    expect(activation).toMatch(/requirements\.profileMessage \?[\s\S]{0,400}LINKR_PROFILE_HANDOFF_CTA/);
  });

  it("enables the real CTA only when every requirement is met", () => {
    expect(activation).toContain("disabled={busy || !requirements.canActivate}");
  });

  it("makes disabled visually distinct from enabled, not merely dimmer", () => {
    const disabled = css.slice(
      css.indexOf(".linkr-primary:disabled"),
      css.indexOf(".linkr-primary:disabled") + 400
    );
    expect(disabled).toContain("box-shadow: none");
    expect(disabled).toContain("cursor: not-allowed");
    expect(disabled).not.toContain("--color-brand-orange");
  });
});

describe("Your Linkr Profile points at Profile for media", () => {
  it("has no uploader of its own", () => {
    expect(editor).not.toMatch(/type="file"/);
    expect(editor).not.toContain("LinkrPhotoEditor");
    expect(editor).not.toContain("onUploadPhoto");
  });

  it("explains where the photos come from and links there", () => {
    expect(editor).toContain("Linkr uses photos from your Mad Buddy profile.");
    expect(editor).toContain("Edit profile photos");
    expect(editor).toContain("onEditProfilePhotos");
  });

  it("keeps Preview my Linkr card", () => {
    expect(editor).toContain("Preview my Linkr card");
  });
});

describe("artwork slot", () => {
  it("shows no developer text in the placeholder", () => {
    const rendered = orb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of ["Linkr artwork", "LINKR ARTWORK", "PLACEHOLDER", "TODO"]) {
      expect(rendered).not.toContain(forbidden);
    }
    expect(css).not.toContain(".linkr-orb__placeholder-note");
  });

  it("keeps the canonical asset paths", () => {
    expect(orb).toContain("/linkr/orb-off.png");
    expect(orb).toContain("/linkr/orb-activate.png");
    expect(orb).toContain("/linkr/orb-empty.png");
  });

  it("reserves stable dimensions so the form cannot be pushed down", () => {
    const orbCss = css.slice(css.indexOf(".linkr-orb {"), css.indexOf(".linkr-orb {") + 220);
    expect(orbCss).toContain("aspect-ratio: 1");
    expect(css).toMatch(/\.linkr-activate \.linkr-orb \{[\s\S]*?max-height/);
  });
});

describe("mobile composition", () => {
  it("lets activation grow instead of clamping it to the viewport", () => {
    const rule = css.slice(css.indexOf(".linkr-activate {\n  min-height: auto;"));
    expect(rule).toMatch(/^\.linkr-activate \{[\s\S]*?min-height: auto/);
    expect(rule).toMatch(/^\.linkr-activate \{[\s\S]*?justify-content: flex-start/);
    expect(rule).toContain("scroll-padding-bottom: var(--mobile-nav-height");
  });

  it("lays the intent choices out deliberately", () => {
    expect(css).toMatch(
      /\.linkr-activate \.linkr-intent__options[\s\S]{0,200}grid-template-columns: repeat\(2/
    );
  });

  it("hides the global bottom navigation while activating", () => {
    expect(activation).toContain('useImmersiveWhile(stage === "consent")');
  });
});
