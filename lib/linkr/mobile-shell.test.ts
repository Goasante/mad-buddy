import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linkrCardTransform } from "@/components/linkr/candidate-card";

const css = readFileSync("app/globals.css", "utf8");
const page = readFileSync("components/linkr/linkr-page.tsx", "utf8");
const profile = readFileSync("components/profile/profile-page.tsx", "utf8");

describe("Linkr mobile shell", () => {
  it("wraps every view in one four-sided platform safe area", () => {
    expect(page).toContain('className="linkr-safe-screen"');
    const start = css.indexOf(".linkr-safe-screen {");
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(rule).toContain(`env(safe-area-inset-${side}, 0px)`);
    }
  });

  it("uses a clipped GPU surface throughout the swipe", () => {
    expect(linkrCardTransform(-110)).toContain("translate3d(-110px, 0, 0)");
    expect(linkrCardTransform(520)).toContain("translate3d(520px, 0, 0)");
    expect(css).toContain("clip-path: inset(0 round 1.5rem)");
    expect(css).toContain("contain: paint");
    expect(css).toContain("transform: translateZ(0)");
  });

  it("keeps Profile mounted during the post-commit Linkr return", () => {
    const save = profile.slice(profile.indexOf("function saveProfile"), profile.indexOf("function selectAvatar"));
    expect(save).toContain("startLinkrReturn(() => router.replace(returnTo as Route))");
    expect(save).not.toContain("router.push(returnTo as Route)");
  });
});
