import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const section = read("components/hangout/owned-upfors-section.tsx");

/**
 * The owner section renders the projection; it does not re-decide it.
 *
 * The behaviour of the projection itself (order, live/scheduled, capacity,
 * scheduled becoming live as the clock moves) is proven in owned-upfors.test.ts
 * against real inputs. These assertions pin the wiring: that the component
 * consumes that authority rather than growing a second copy of the rules in
 * JSX, which is how presentation logic quietly forks.
 */
describe("the owner section defers to the domain projection", () => {
  it("renders from ownedUpForViews rather than sorting in JSX", () => {
    expect(section).toContain("ownedUpForViews(ownedUpFors, nowMs)");
  });

  it("asks the projection about capacity instead of counting inline", () => {
    expect(section).toContain("ownedUpForCapacityLabel(ownedUpFors, nowMs)");
    expect(section).toContain("canOfferAnotherUpFor(ownedUpFors, nowMs)");
  });

  it("re-implements none of the projection's rules", () => {
    // Any of these appearing here would mean two authorities for one decision.
    for (const leak of [".sort(", "starts_at", "status ===", "Live now ·", "of 3 today"]) {
      expect(section, leak).not.toContain(leak);
    }
  });

  it("uses the canonical activity labels, not a second mapping", () => {
    expect(section).toContain("HANGOUT_ACTIVITY_LABELS");
  });
});

describe("the section is a list, not a dashboard", () => {
  it("renders each owned UpFor as one row", () => {
    expect(section).toContain("views.map(");
    expect(section).toContain("<li");
  });

  it("gives each row exactly one management affordance", () => {
    // Not Edit + Requests + End + Plan as four permanent buttons per row.
    expect((section.match(/<button/g) ?? []).length).toBe(1);
  });

  it("renders nothing at all when the owner holds none", () => {
    // An empty management panel would only say "you have 0 records"; the
    // page's own creation experience is the focus instead.
    expect(section).toContain("if (views.length === 0) return null;");
  });
});

describe("state is legible without colour", () => {
  it("shows the projection's time sentence as text", () => {
    expect(section).toContain("{view.timeLabel}");
  });

  it("does not signal live state with a dot, glow or pulse", () => {
    for (const decoration of ["animate-pulse", "proximity-glow", "rounded-full bg-primary"]) {
      expect(section, decoration).not.toContain(decoration);
    }
  });
});

describe("accessibility and interaction targets", () => {
  it("names the UpFor in the management control's accessible name", () => {
    expect(section).toContain("aria-label={");
    expect(section).toContain("`Manage ${label} UpFor`");
  });

  it("says how many requests are waiting in that same name", () => {
    expect(section).toContain('`Manage ${label} UpFor, ${pending} ${pending === 1 ? "request" : "requests"}`');
  });

  it("keeps the management target at least 44px", () => {
    expect(section).toContain("h-11 w-11");
  });

  it("labels its own region", () => {
    expect(section).toContain('aria-labelledby="owned-upfors-heading"');
  });
});

describe("the section decides nothing the server owns", () => {
  it("reports capacity but never enforces it", () => {
    // No client-side ceiling arithmetic, and above all no cancelling a sibling
    // to make room -- the defect this whole repair exists for.
    for (const forbidden of ["endHangoutAction", "> 3", ">= 3", "slice(0, 3)"]) {
      expect(section, forbidden).not.toContain(forbidden);
    }
  });

  it("raises create and manage as intents for the page to handle", () => {
    expect(section).toContain("onCreate");
    expect(section).toContain("onManage(view.id)");
  });
});
