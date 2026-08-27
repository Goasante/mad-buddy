import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const card = read("components/linkr/candidate-card.tsx");
const css = read("app/globals.css");

describe("approved Linkr candidate card composition", () => {
  it("caps the visual sequence at three projected photos", () => {
    expect(card).toContain("candidate.photos.slice(0, 3)");
    expect(card).toContain("total > 1");
    expect(card).toContain("linkr-card__progress-seg");
  });

  it("keeps tap-edge photo browsing distinct from swipe decisions", () => {
    expect(card).toContain("tapZone(event.clientX - rect.left, rect.width)");
    expect(card).toContain("linkr-card__edge--previous");
    expect(card).toContain("linkr-card__edge--next");
    expect(card).toContain("Swipe to decide");
    expect(card).toContain("Tap edges for more photos");
  });

  it("presents bio before bounded interests and no shared-group row", () => {
    expect(card.indexOf("linkr-card__bio")).toBeLessThan(card.indexOf("linkr-card__interests"));
    expect(card).toContain("candidate.interests.slice(0, 4)");
    expect(card).not.toMatch(/Both in|shared.group/i);
  });

  it("keeps Pass quiet and Connect orange with the approved wave hand", () => {
    expect(card).toContain("linkr-action--pass");
    expect(card).toContain("linkr-action--connect");
    expect(card).toContain("<Hand aria-hidden />");
    expect(css).toMatch(/\.linkr-action--connect[\s\S]*background: var\(--color-brand-orange\)/);
  });
});
