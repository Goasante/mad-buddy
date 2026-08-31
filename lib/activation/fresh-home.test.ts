import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The first screen a new account ever sees.
 *
 * One greeting, one job, and content that does not hide under the bar.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const card = stripComments(readFileSync("components/activation/activation-card.tsx", "utf8"));
const shell = stripComments(readFileSync("components/app-shell/app-shell.tsx", "utf8"));

describe("Home greets once", () => {
  it("does not print a fixed title above the greeting", () => {
    // "Welcome" sat directly above "Good afternoon, Muddy1", greeting the same
    // person twice in two sizes and spending the best space saying nothing.
    expect(home).not.toContain('text="Welcome"');
  });

  it("uses the time-of-day line as the heading", () => {
    expect(home).toContain("text={greetingSubtitle(displayName || null, new Date())}");
  });

  it("drops the trailing full stop now that it is a heading", () => {
    const fn = home.slice(home.indexOf("function greetingSubtitle"), home.indexOf("function greetingSubtitle") + 400);
    expect(fn).toContain("`${partOfDay}, ${name}`");
  });
});

describe("the first job is one Muddy, not generic discovery", () => {
  const noMuddies = card.slice(card.indexOf("no_muddies:"), card.indexOf("muddies_no_location:"));

  it("names the actual task on the button", () => {
    expect(noMuddies).toContain('actionLabel: "Find your first Muddy"');
  });

  it("no longer says the generic thing", () => {
    expect(card).not.toContain('"Find your people"');
  });

  it("promises the payoff rather than sounding empty until a crowd arrives", () => {
    /* Asserts the PROMISE, not the sentence.
     *
     * Pinning the exact wording would block the copy refinement this card will
     * keep getting. What must stay true: one Muddy is enough, glow is what
     * they get, and there is something to do afterwards. */
    expect(noMuddies).toMatch(/first Muddy|someone you already know/);
    // Either case: "Glow" is the product noun, "glow" the plain word, and the
    // copy may legitimately use either.
    expect(noMuddies).toMatch(/[Gg]low/);
    expect(noMuddies).toMatch(/say hi|make a plan/);
  });

  it("keeps the body short enough to read at a glance", () => {
    // An invitation, not an explanation page. One sentence, two lines on a
    // phone -- a third line was pure card height.
    const body = noMuddies.slice(noMuddies.indexOf("body:"), noMuddies.indexOf("actionLabel:"));
    expect(body.length).toBeLessThan(140);
  });

  it("keeps the invite route clearly secondary", () => {
    // A link, never a second button of equal weight.
    expect(noMuddies).toContain('secondary: { label: "Share your invite link"');
    expect(card.split("<Button asChild").length - 1).toBe(1);
  });

  it("compresses spacing rather than type", () => {
    /* The card had to get shorter WITHOUT becoming a miniature.
     *
     * So the primary action keeps its full size, and the type scale is
     * untouched: xl headline, sm body, xs privacy line. Only the gaps and the
     * vertical padding moved. Shrinking the font would have hit legibility and
     * the touch target, which is the wrong trade. */
    // The JSX, not the prose: an earlier version of this matched the word
    // "size=lg" inside a nearby comment, so shrinking the real Button passed.
    expect(card).toContain('<Button asChild size="lg"');
    expect(card).toContain("text-xl font-semibold");
    expect(card).toContain("text-sm leading-relaxed");
    expect(card).toContain("py-4 sm:px-6 sm:py-5");
  });
});

describe("privacy is one line, not a card", () => {
  it("reassures where connecting is asked for", () => {
    expect(card).toContain("Only approved Muddies. Never your exact location.");
  });

  it("is a single line of small text, not a panel", () => {
    const note = card.slice(card.indexOf("{copy.privacyNote ?"), card.indexOf("{copy.privacyNote ?") + 300);
    expect(note).toContain("<p");
    expect(note).toContain("text-xs");
  });
});

describe("Glow is introduced without inventing anybody", () => {
  it("uses the approved brand symbol", () => {
    expect(card).toContain("brandSymbol");
  });

  it("uses the app's own glow token", () => {
    expect(card).toContain("var(--glow-gradient)");
  });

  it("fabricates no nearby people, avatars or distances", () => {
    const mark = card.slice(card.indexOf("function GlowIntroMark"), card.indexOf("export function ActivationCard"));
    for (const term of ["Avatar", "GlowAvatar", "km", "metres", "Radar", "MapPin"]) {
      expect(mark).not.toContain(term);
    }
  });
});

describe("Glow reads as proximity, and respects reduced motion", () => {
  const mark = card.slice(card.indexOf("function GlowIntroMark"), card.indexOf("export function ActivationCard"));

  it("grades several rings rather than drawing one circle", () => {
    // One ring read as "logo in a circle". The falloff is what says presence
    // concentrates nearby and fades with distance.
    expect((mark.match(/rounded-full border border-primary/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("carries the meaning in opacity, not colour alone", () => {
    expect(mark).toMatch(/primary\/\d+/);
  });

  it("disables its motion under prefers-reduced-motion", () => {
    expect(mark).toContain("motion-reduce:animate-none");
  });

  it("stays large enough for three rings to stay separable", () => {
    // Below roughly 56px the graded falloff collapses into one thick edge and
    // the proximity idea is lost, so the mark shrank to 60px and no further.
    expect(mark).toContain("h-[3.75rem] w-[3.75rem]");
  });

  it("animates opacity only, so the symbol cannot shift or blur", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const frames = css.slice(css.indexOf("@keyframes activation-glow"));
    const block = frames.slice(0, frames.indexOf("}", frames.indexOf("50%")) + 1);
    expect(block).toContain("opacity");
    expect(block).not.toContain("transform");
    expect(block).not.toContain("scale");
  });
});

describe("the Smart Card yields while activation owns the screen", () => {
  const smart = stripComments(readFileSync("components/journey/smart-card.tsx", "utf8"));

  it("drops the saturated gradient when deferred", () => {
    // A full-bleed magenta card below a pale hero pulled the eye downward, so
    // the most vivid object on a fresh Home was not the next step.
    expect(smart).toContain("deferred");
    const surface = smart.slice(smart.indexOf("deferred"), smart.indexOf("linear-gradient"));
    expect(surface).toContain("bg-card/70");
  });

  it("keeps its text readable on the lighter surface", () => {
    // White copy on a warm-white card would be invisible.
    expect(smart).toContain('deferred ? "text-foreground" : "text-white"');
  });

  it("never defers a safety state", () => {
    // A live Safe Arrival outranks activation by design.
    expect(home).toContain('smartCard.id !== "safe_arrival"');
  });

  it("no longer exempts the Journey card", () => {
    /* This USED to assert `smartCard.id !== "journey"`, on the belief that the
     * Journey outranked activation. It does not: the Journey IS a second
     * activation system, and its "Turn On Visibility" step gave the same
     * instruction as the card above it with a different destination. It is now
     * suppressed outright during early activation rather than exempted from
     * dimming. */
    expect(home).not.toContain('smartCard.id !== "journey"');
    expect(home).toContain("composition.showJourneyCard");
  });

  it("only defers while an activation state exists", () => {
    expect(home).toContain("Boolean(activationState) &&");
  });
});

describe("content clears the fixed bottom bar", () => {
  const main = shell.slice(shell.indexOf('id="app-main-content"'), shell.indexOf('id="app-main-content"') + 1200);

  it("reserves the bar's footprint on the element that scrolls", () => {
    // The outer shell's padding sits outside <main>'s scroll box, so the last
    // card slid under the bar regardless of it.
    expect(main).toContain("var(--mobile-nav-height)");
    expect(main).toContain("env(safe-area-inset-bottom,0px)");
  });

  it("computes it from canonical variables, not a per-device number", () => {
    expect(main).not.toMatch(/pb-\[\d+px\]/);
  });

  it("releases the reservation when the bar steps aside", () => {
    // An open conversation hides the bar; keeping the padding would leave a
    // dead strip at the bottom of the thread.
    expect(main).toContain("immersive");
  });

  it("does not apply the mobile inset on desktop, which has no bottom bar", () => {
    expect(main).toContain("md:pb-5");
  });
});

describe("first-session priority", () => {
  it("puts the activation hero above every other Home surface", () => {
    const activationAt = home.indexOf("<ActivationCard");
    for (const later of ["<SmartCardHero", "<NearbyHero", "<TopEventsHome", "<ProfileCompletionReminder"]) {
      expect(activationAt).toBeLessThan(home.indexOf(later));
    }
  });

  it("keeps profile completion as a low-priority row", () => {
    const reminder = stripComments(
      readFileSync("components/profile/profile-completion-reminder.tsx", "utf8")
    );
    // Compact neutral surface, not a saturated promotional banner.
    expect(reminder).toContain("bg-card/50");
    expect(reminder).not.toMatch(/from-(rose|pink|red|fuchsia)/);
  });
});
