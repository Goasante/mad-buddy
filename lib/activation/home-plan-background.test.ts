import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const activation = read("components/activation/activation-card.tsx");
const shell = read("components/app-shell/app-shell.tsx");
const planImage = readFileSync(join(process.cwd(), "public/home/open-your-plan-bg.webp"));

describe("quick Home polish follow-up", () => {
  it("moves mobile nav graphics another step down without increasing the bar", () => {
    expect(shell.match(/min-w-0 flex-1 pb-0 pt-4/g) ?? []).toHaveLength(2);
    expect(shell).not.toContain('className="min-w-0 flex-1 pb-1 pt-3"');
  });

  it("keeps the upcoming-plan artwork wired and commits a real WebP", () => {
    expect(activation).toContain('src="/home/open-your-plan-bg.webp"');
    expect(planImage.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(planImage.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(planImage.byteLength).toBeGreaterThan(8000);
  });
});
