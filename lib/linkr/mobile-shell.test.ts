import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linkrCardTransform } from "@/components/linkr/candidate-card";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const css = readFileSync("app/globals.css", "utf8");
const page = read("components/linkr/linkr-page.tsx");
const profile = read("components/profile/profile-page.tsx");
const loading = read("app/(app)/linkr/loading.tsx");

describe("Linkr owns one complete mobile safe-area shell", () => {
  it("wraps every Linkr view above the stateful content switch", () => {
    const wrapper = page.slice(page.indexOf("export function LinkrPage"), page.indexOf("function LinkrPageContent"));
    expect(wrapper).toContain('className="linkr-safe-screen"');
    expect(wrapper).toContain("<LinkrPageContent {...props} />");
  });

  it("uses all four platform safe-area insets without pixel guesses", () => {
    const start = css.indexOf(".linkr-safe-screen {");
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(rule).toContain(`env(safe-area-inset-${side}, 0px)`);
    }
  });

  it("gives the fixed match overlay its own four-sided safe area", () => {
    const start = css.indexOf(".linkr-match {");
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(rule).toContain(`env(safe-area-inset-${side}, 0px)`);
    }
  });
});

describe("the primary mobile surfaces are full bleed", () => {
  const shell = read("components/app-shell/app-shell.tsx");

  it("routes Home, Muddies, Linkr and Messages through the one route-aware contract", () => {
    /* One list, checked by one helper -- not a per-page negative margin. A
       shell-level -mx hack would have to be undone by every page that is NOT
       full bleed, which is how two surfaces start disagreeing about the
       gutter. */
    const list = shell.slice(shell.indexOf("const FULL_BLEED_PAGES"));
    const declaration = list.slice(0, list.indexOf(";"));
    for (const route of ["/messages", "/dashboard", "/friends", "/linkr"]) {
      expect(declaration).toContain(`"${route}"`);
    }
    expect(shell).toContain("function isFullBleed(pathname: string)");
  });

  it("drops only the shell's own gutter, and only below md", () => {
    expect(shell).toContain('fullBleed ? "px-0 md:px-6 lg:px-8" : "px-4 sm:px-6 lg:px-8"');
  });

  it("uses no negative-margin hack at the shell level", () => {
    const main = shell.slice(shell.indexOf("fullBleed ? \"px-0"));
    expect(main.slice(0, 400)).not.toContain("-mx-");
  });

  it("keeps a page's own side padding, so nothing sits on the screen edge", () => {
    /* Full bleed removes the SHELL's competing gutter; it does not push text
       into the bezel. Home and Muddies had no horizontal padding of their own
       -- they leaned entirely on the shell's px-4 -- so each now supplies the
       same 1rem itself and hands it back at md+. Linkr already had its own via
       .linkr-shell. */
    expect(read("components/dashboard/dashboard-page.tsx")).toContain("space-y-5 px-4 pt-4 md:px-0");
    expect(read("components/friends/friends-page.tsx")).toContain("overflow-x-clip px-4 md:px-0");
    const shellStart = css.indexOf(".linkr-shell {");
    expect(css.slice(shellStart, css.indexOf("}", shellStart))).toContain("padding:");
  });
});

describe("Linkr dark mode belongs to the app shell", () => {
  it("paints the shell's near-black canvas rather than the warm --background", () => {
    /* --background in dark mode is hue 8 (a warm brown), so painting it here
       produced a brown slab inside the shell's #111112 frame -- two competing
       surfaces. Same defect Messages had, same fix. */
    const start = css.indexOf("html.dark .linkr-safe-screen {");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(css.slice(start, css.indexOf("}", start))).toContain("#111112");
  });

  it("does not repaint that canvas further down the tree", () => {
    // The card stage sat on top of the page canvas painting --background again.
    const start = css.indexOf(".linkr-card-stage {");
    expect(css.slice(start, css.indexOf("}", start))).toContain("background: transparent");
  });

  it("leaves the candidate card its own colour, so it still lifts off the ground", () => {
    /* "Remove the competing page canvas" is not "make everything black": the
       card, overlays and sheets keep their --card surfaces. */
    const start = css.lastIndexOf(".linkr-card {");
    expect(css.slice(start, css.indexOf("}", start))).not.toContain("#111112");
  });

  it("leaves light mode on Warm Paper", () => {
    // The override is scoped to html.dark; the base rule is untouched.
    const base = css.slice(css.indexOf(".linkr-safe-screen {"));
    expect(base.slice(0, base.indexOf("}"))).toContain("background: hsl(var(--background))");
  });
});

describe("Profile to Linkr continuity", () => {
  it("keeps Profile mounted and replaces the handoff history entry exactly once", () => {
    const save = profile.slice(profile.indexOf("function saveProfile"), profile.indexOf("function selectAvatar"));
    expect((save.match(/router\.replace\(returnTo as Route\)/g) ?? []).length).toBe(1);
    expect(save).not.toContain("router.push(returnTo as Route)");
    const returnBranch = save.slice(
      save.indexOf("if (returnTo && nextProfile.dateOfBirth && avatarUrl)"),
      save.indexOf("} else {", save.indexOf("if (returnTo && nextProfile.dateOfBirth && avatarUrl)"))
    );
    expect(returnBranch).not.toContain("setEditing(false)");
    expect(returnBranch).toContain("startLinkrReturn");
  });

  it("uses the same non-flickering handoff after a standalone photo completion", () => {
    const avatarSave = profile.slice(profile.indexOf("function saveAvatar"), profile.indexOf("const ghostOn"));
    expect(avatarSave).toContain("avatarUploading || returningToLinkr");
    expect(avatarSave).toContain("startLinkrReturn(() => router.replace(returnTo as Route))");
    expect(avatarSave).not.toContain("router.push(returnTo as Route)");
  });

  it("shows an intentional server-eligibility refresh instead of a stale Linkr state", () => {
    expect(loading).toContain('className="linkr-safe-screen"');
    expect(loading).toContain("Refreshing your Linkr…");
    expect(loading).toContain("Checking your profile");
  });
});

describe("swipe compositor invariants", () => {
  it("uses one GPU transform for rest, left drag, right drag and exits", () => {
    expect(linkrCardTransform(0)).toBe("translate3d(0px, 0, 0) rotate(0deg)");
    expect(linkrCardTransform(-110)).toContain("translate3d(-110px, 0, 0)");
    expect(linkrCardTransform(110)).toContain("translate3d(110px, 0, 0)");
    expect(linkrCardTransform(-520)).toContain("translate3d(-520px, 0, 0)");
    expect(linkrCardTransform(520)).toContain("translate3d(520px, 0, 0)");
  });

  it("clips the promoted image and rotating card as one rounded paint surface", () => {
    const clipAt = css.indexOf("clip-path: inset(0 round 1.5rem)");
    const cardStart = css.lastIndexOf(".linkr-card {", clipAt);
    const card = css.slice(cardStart, css.indexOf("}", cardStart) + 1);
    expect(card).toContain("overflow: clip");
    expect(card).toContain("clip-path: inset(0 round 1.5rem)");
    expect(card).toContain("contain: paint");
    expect(card).toContain("backface-visibility: hidden");
    const photoStart = css.indexOf(".linkr-card__photo {", cardStart);
    const photo = css.slice(photoStart, css.indexOf("}", photoStart) + 1);
    expect(photo).toContain("display: block");
    expect(photo).toContain("border-radius: inherit");
    expect(photo).toContain("transform: translateZ(0)");
  });
});
