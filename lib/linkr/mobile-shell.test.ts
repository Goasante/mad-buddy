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
