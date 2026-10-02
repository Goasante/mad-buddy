import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("components/safety/safe-arrival-page.tsx", "utf8");
const parts = readFileSync("components/safety/journey-parts.tsx", "utf8");

describe("Safe Arrival viewport shell", () => {
  it("uses one fixed Back + Safe Arrival header for every state", () => {
    expect((page.match(/<PageHeader/g) ?? []).length).toBe(1);
    expect(page).toContain('<PageHeader title="Safe Arrival" backHref="/dashboard" />');
    expect(page).toContain('hidden text-xl font-semibold tracking-tight md:block');
  });

  it("keeps the ordinary active journey compact enough to avoid unnecessary scrolling", () => {
    expect(page).toContain('data-tour-id={TOUR_TARGET_IDS.SAFE_ARRIVAL_ACTIVE} className="space-y-3"');
    expect(page).toContain('min-h-[8.5rem] sm:min-h-[10rem]');
    expect(page).toContain('<JourneyStageRail journey={journey} nowMs={nowMs} className="p-3 sm:p-4" />');
    expect(page).toContain('className="space-y-1.5"');
  });

  it("still lets exceptional content make the shell scroll instead of clipping it", () => {
    const active = page.slice(page.indexOf("function ActiveJourneyView"), page.indexOf("function WatcherJourneyView"));
    expect(active).not.toContain("overflow-hidden");
    expect(active).not.toContain("h-[100dvh]");
    expect(active).toContain('tone === "overdue"');
    expect(active).toContain("moreOpen");
    expect(active).toContain('realtime.state === "offline"');
  });

  it("lets only the active contact card opt into compact padding", () => {
    expect(parts).toContain("className?: string;");
    expect(parts).toContain('cn("rounded-[1.25rem] border border-border/70 bg-card/60 p-4", className)');
  });
});
