import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const header = read("components/app-shell/mobile-page-header.tsx");

describe("mobile page header layout", () => {
  it("centres the title with a real three-column grid", () => {
    // auto / 1fr / auto means the title is centred against the header itself,
    // so it cannot shift when the right-hand cluster changes width.
    expect(header).toContain("grid-cols-[auto_1fr_auto]");
    expect(header).toContain('className="text-center');
  });

  it("renders the title from a prop, so every screen supplies its own", () => {
    expect(header).toContain("title: string");
    expect(header).toContain("{title}");
  });

  it("respects the top safe area", () => {
    expect(header).toContain("env(safe-area-inset-top,0px)");
  });

  it("is mobile-only, leaving desktop chrome untouched", () => {
    expect(header).toContain("md:hidden");
  });
});

describe("mobile page header controls", () => {
  it("gives every control the same 44px hit target", () => {
    // One shared constant rather than four hand-written class strings.
    expect(header).toContain("const HIT_TARGET");
    expect(header).toContain("h-11 w-11");
    // Menu, Notifications and Quick Controls all route through the shared
    // helpers; Add Muddy composes the same constant.
    expect(header).toContain("cn(\n            HIT_TARGET,");
  });

  it("uses one optical size and one stroke weight for every icon", () => {
    expect(header).toContain('const ICON = "h-[22px] w-[22px]"');
    expect(header).toContain("const STROKE = 1.75");
    // No icon may hardcode its own size alongside the shared constant.
    const iconUsages = header.match(/className=\{ICON\}/g) ?? [];
    expect(iconUsages.length).toBe(3);
  });

  it("uses only the four specified Lucide icons", () => {
    expect(header).toContain('import { Bell, Menu, MoreHorizontal, UserPlus } from "lucide-react"');
  });

  it("gives each control a press animation that respects reduced motion", () => {
    expect(header).toContain("active:scale-95");
    expect(header).toContain("motion-reduce:active:scale-100");
  });
});

describe("mobile page header Add Muddy badge", () => {
  it("shows the badge only when requests are pending", () => {
    expect(header).toContain("const hasRequests = incomingRequestCount > 0;");
    expect(header).toContain("{hasRequests ? (");
  });

  it("caps the displayed count at 9+", () => {
    expect(header).toContain('incomingRequestCount > 9 ? "9+" : incomingRequestCount');
  });

  it("is documented as pending incoming requests, never a notification count", () => {
    expect(header).toContain("Never a notification count");
    // The header takes a count as a prop; it cannot read a notifications store.
    expect(header).not.toContain("unreadCount");
    expect(header).not.toContain("notificationCount");
  });

  it("announces the pending count to screen readers", () => {
    expect(header).toContain("pending ${incomingRequestCount === 1 ? \"request\" : \"requests\"}");
  });
});

describe("mobile page header adoption", () => {
  it("is used by Home rather than an inline copy", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).toContain("<MobilePageHeader");
    // The inline header is gone: no stray <header> remains in the page.
    expect(home).not.toContain("<header");
  });
});

describe("header sheet transitions", () => {
  const css = read("app/globals.css");

  it("gives Quick Controls a spring", () => {
    expect(css).toContain("@keyframes account-sheet-spring");
    // The overshoot past 0 is what makes it a spring rather than a slide.
    expect(css).toContain("70% { transform: translateY(-0.5rem)");
  });

  it("gives Menu a slide, not the spring", () => {
    expect(css).toContain("@keyframes menu-sheet-slide");
    const slide = css.slice(css.indexOf("@keyframes menu-sheet-slide"), css.indexOf(".menu-sheet-panel"));
    expect(slide).not.toContain("-0.5rem");
    expect(read("components/dashboard/home-settings-sheet.tsx")).toContain("menu-sheet-panel");
  });

  it("disables both transitions under reduced motion", () => {
    for (const panel of [".account-sheet-panel", ".menu-sheet-panel"]) {
      const block = css.slice(css.indexOf(`${panel}[data-state="open"]`));
      const reduced = block.slice(0, block.indexOf("@media (min-width"));
      expect(reduced, `${panel} must no-op under reduced motion`).toContain("animation: none");
    }
  });
});
