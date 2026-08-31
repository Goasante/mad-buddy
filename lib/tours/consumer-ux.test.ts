import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeTourReplay, TOUR_REPLAY_COOKIE, TOUR_REPLAY_MAX_AGE_SECONDS } from "@/lib/tours/replay";
import { PRODUCT_EVENT_NAMES } from "@/lib/analytics/product-analytics";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Code with comment lines removed. These assertions are about behaviour, and
 * the files legitimately explain that behaviour in prose, so a bare substring
 * search would match the explanation rather than the implementation.
 */
const stripComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

/** Just the .tour-spotlight-target rule body, not whatever CSS follows it. */
const spotlightRule = (css: string) => {
  const start = css.indexOf(".tour-spotlight-target {");
  return css.slice(start, css.indexOf("}", start) + 1);
};
const VERSION = "6ff7bdc0-8ab5-4a00-843c-98bfca165de8";

describe("replay survives the tour's own navigation", () => {
  const launcher = read("components/tours/walkthrough-replay.tsx");
  const host = read("components/tours/tour-host.tsx");

  it("the settings launcher no longer mounts the tour itself", () => {
    // ROOT CAUSE of the cut-off bug: the runner was mounted on
    // /settings/walkthrough, and step 1 routes to /dashboard, so the tour's own
    // first navigation unmounted the page hosting it.
    expect(launcher).not.toContain("TourRunner");
    expect(launcher).toContain("startTourReplayAction");
  });

  it("the shell host renders replay, so it outlives route changes", () => {
    expect(host).toContain("decodeTourReplay");
    expect(host).toContain("getPublishedTourById");
    // TourHost is mounted by the (app) layout, which persists across client
    // navigations within the authenticated app.
    expect(read("app/(app)/layout.tsx")).toContain("TourHost");
  });

  it("uses a cookie rather than a module global or component state", () => {
    const replay = read("lib/tours/replay.ts");
    expect(replay).toContain(TOUR_REPLAY_COOKIE);
    expect(read("app/(app)/tour-replay-actions.ts")).toContain("httpOnly: true");
    expect(TOUR_REPLAY_MAX_AGE_SECONDS).toBeGreaterThan(0);
  });

  it("validates the cookie and rejects junk", () => {
    expect(decodeTourReplay(VERSION)).toBe(VERSION);
    for (const bad of [undefined, "", "nope", "../etc", `${VERSION} `]) {
      expect(decodeTourReplay(bad)).toBeNull();
    }
  });

  it("replay always starts at step one", () => {
    const replayBlock = host.slice(host.indexOf("decodeTourReplay"));
    expect(replayBlock).toMatch(/startIndex=\{0\}/);
  });
});

describe("replay preserves history and stays out of the first-time funnel", () => {
  const runner = read("components/tours/tour-runner.tsx");
  const actions = read("app/(app)/tour-replay-actions.ts");

  it("writes no progress during replay", () => {
    // Reuses the server-side preview short-circuit, so no user_tour_progress row
    // is written and the original completion or skip is untouched.
    expect(runner).toContain("preview: preview || replay");
    expect(stripComments(actions)).not.toContain("user_tour_progress");
  });

  it("records replay-specific events instead of tour_completed", () => {
    expect(PRODUCT_EVENT_NAMES).toContain("tour_replay_started");
    expect(PRODUCT_EVENT_NAMES).toContain("tour_replay_completed");
    expect(actions).toContain("tour_replay_started");
    expect(actions).toContain("tour_replay_completed");
  });

  it("only ever replays a published version", () => {
    // A replay must never become a route to unpublished content.
    expect(actions).toContain('.eq("status", "published")');
  });

  it("clears the session when the tour ends, so it does not restart", () => {
    expect(runner).toContain("endTourReplayAction");
    expect(actions).toContain("store.delete");
  });
});

describe("walkthrough copy", () => {
  const migration = read("supabase/migrations/20260730120000_tour_copy_polish.sql");

  it("contains no em dashes anywhere in tour copy", () => {
    expect(migration).not.toContain("—");
  });

  it("leads with product value rather than a second welcome", () => {
    expect(migration).toContain("See who''s around");
    expect(migration).toContain("Nearby Muddies");
    expect(migration).toContain("Your location stays yours");
  });

  it("uses the agreed subscription headline", () => {
    expect(migration).toContain("Make Mad Buddy yours");
  });

  it("updates steps in place rather than recreating them", () => {
    // Recreating would issue new step ids and orphan the per-step analytics
    // already recorded against the old ones.
    expect(migration).toMatch(/^update public\.tour_steps/m);
    expect(migration).not.toMatch(/insert into public\.tour_steps/);
    expect(migration).not.toMatch(/delete from public\.tour_steps/);
  });
});

describe("tour visual language", () => {
  const css = read("app/globals.css");
  const runner = read("components/tours/tour-runner.tsx");

  it("spotlights in Mad Buddy brand orange, not the user's chosen accent", () => {
    // Just this one rule, comments stripped: the rationale comment names
    // --primary, which is not the same as using it.
    const spotlight = stripComments(spotlightRule(css));
    // --primary follows data-accent, and green/blue/violet are all selectable,
    // so the tour would otherwise inherit whatever accent the user picked.
    expect(spotlight).toContain("--color-brand-orange");
    expect(spotlight).not.toContain("var(--primary)");
  });

  it("uses a thin outline with a soft glow rather than a heavy box", () => {
    const spotlight = spotlightRule(css);
    expect(spotlight).toMatch(/outline:\s*1\.5px/);
    expect(spotlight).toContain("border-radius: inherit");
  });

  it("transitions between targets and respects reduced motion", () => {
    expect(css).toMatch(/\.tour-spotlight-target[\s\S]{0,600}transition:/);
    const reduced = css.slice(css.lastIndexOf("prefers-reduced-motion", css.indexOf("tour-spotlight-in") + 2000));
    expect(reduced).toContain("transition: none");
  });

  it("shows a brand mark on the invitation instead of a generic sparkle", () => {
    expect(runner).toContain("BrandMark");
    expect(runner).not.toContain("Sparkles");
  });

  it("has an accent progress indicator", () => {
    expect(runner).toContain('role="progressbar"');
    expect(runner).toContain("--color-brand-orange");
  });
});

describe("tour navigation and actions", () => {
  const runner = read("components/tours/tour-runner.tsx");

  it("offers Skip tour inside the walkthrough", () => {
    /* The automatic floating invitation -- and with it "Not now" and "Take the
       tour" -- was turned off on 2026-08-31 because it covered primary product
       actions on short viewports. A tour a person actually starts still runs,
       and it still offers a way out, which is what this protects. */
    expect(runner).toContain("Skip tour");
    expect(runner).not.toContain("Take the tour");
  });

  it("ends with the explicit Finish action", () => {
    expect(runner).toContain('isLast ? "Finish" : "Next"');
  });

  it("a CTA does not complete the tour", () => {
    // Following "Explore plans" is not finishing the walkthrough; marking it
    // complete would both distort analytics and stop it being offered again.
    // Scoped to the CTA handler only, ending at its own router.push. A wider
    // window would catch the Next button's legitimate finish() on the last step.
    const start = runner.indexOf('recordStep(step.id, "tour_cta_clicked")');
    const block = runner.slice(start, runner.indexOf("router.push(step.ctaHref", start));
    expect(block.length).toBeGreaterThan(0);
    // Comments stripped: the rationale comment itself says "Must NOT finish()".
    expect(stripComments(block)).not.toContain("finish()");
    expect(block).toContain('record("started"');
  });

  it("keeps Escape and focus management", () => {
    expect(runner).toContain('event.key === "Escape"');
    expect(runner).toContain("cardRef.current?.focus()");
  });
});

describe("subscription education uses canonical data only", () => {
  const runner = read("components/tours/tour-runner.tsx");

  it("renders per-plan values from resolved entitlements, never literals", () => {
    expect(runner).toContain("entry.free");
    expect(runner).toContain("entry.buddyPlus");
    expect(runner).toContain("entry.buddyPro");
  });

  it("never hardcodes an unlimited or numeric plan claim in the component", () => {
    // Values come from entitlementsFor() on the server; the component must not
    // assert capability of its own.
    const suspicious = runner.match(/"(Unlimited|Unlimited [A-Za-z]+)"/g) ?? [];
    expect(suspicious).toEqual([]);
  });

  it("does not tell a Pro user to upgrade", () => {
    expect(runner).toContain("You're on Buddy Pro");
  });

  it("keeps Free respectable rather than styling it as lesser", () => {
    // Asserts the INTENT rather than one copy string, which changed when the
    // vague promises ("The essentials.") were replaced with concrete ones.
    expect(runner).toContain("Everything you need to start");
    // Free gets a real promise and a real column, and is never dimmed or
    // labelled as limited relative to the paid tiers.
    const block = runner.slice(runner.indexOf("{stepEntitlements.length > 0 ? ("));
    expect(block).toContain('{ key: "free", label: "Free"');
    expect(block).not.toMatch(/free[\s\S]{0,120}opacity-\d/);
  });
});

describe("draft preview remains side-effect free after these changes", () => {
  it("still short-circuits progress and step analytics", () => {
    const service = read("lib/tours/service.ts");
    expect([...service.matchAll(/if \(input\.preview\) return true;/g)].length).toBe(2);
  });

  it("still renders through the shared runner with an exit path", () => {
    const host = read("components/tours/tour-host.tsx");
    expect(host).toContain("loadTourForPreview");
    expect(host).toContain("previewReturnTo");
    expect(read("components/tours/tour-runner.tsx")).toContain("Exit preview");
  });
});
