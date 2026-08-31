import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const activation = read("components/activation/activation-card.tsx");
const shell = read("components/app-shell/app-shell.tsx");

describe("quick Home polish", () => {
  it("moves mobile nav graphics down without making the bar taller", () => {
    expect(shell.match(/min-w-0 flex-1 pb-1 pt-3/g) ?? []).toHaveLength(2);
    expect(shell).not.toContain('className="min-w-0 flex-1 py-2"');
  });

  it("uses the approved plan image only for the upcoming-plan state", () => {
    expect(activation).toContain('const upcomingPlan = state === "upcoming_plan";');
    expect(activation).toContain('src="/home/open-your-plan-bg.webp"');
    expect(activation).toContain("linear-gradient(90deg,rgba(18,8,6,0.94)");
    expect(activation).toContain('upcomingPlan ? "text-white/80" : "text-muted-foreground"');
  });
});
