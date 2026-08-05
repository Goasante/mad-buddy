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
    expect(header).toContain("{hasRequests ? <HeaderBadge count={incomingRequestCount} /> : null}");
  });

  it("caps the displayed count at 9+", () => {
    expect(header).toContain('count > 9 ? "9+" : count');
  });

  it("is documented as pending incoming requests, never a notification count", () => {
    expect(header).toContain("Never a notification count");
  });

  it("announces the pending count to screen readers", () => {
    expect(header).toContain("pending ${incomingRequestCount === 1 ? \"request\" : \"requests\"}");
  });
});

describe("mobile page header notification badge", () => {
  it("shows the Bell badge only when there are unread notifications", () => {
    expect(header).toContain("const hasUnread = unreadNotificationCount > 0;");
    expect(header).toContain("{hasUnread ? <HeaderBadge count={unreadNotificationCount} /> : null}");
  });

  it("takes the count as a prop rather than counting anything itself", () => {
    expect(header).toContain("unreadNotificationCount?: number");
    // No fetching, no store access — the header only renders what it is given.
    expect(header).not.toContain("fetch(");
    expect(header).not.toContain("useEffect(() => {\n    void");
  });

  it("keeps the two badge streams separate and never sums them", () => {
    expect(header).toContain("never be merged or summed");
    expect(header).not.toContain("incomingRequestCount + unreadNotificationCount");
    expect(header).not.toContain("unreadNotificationCount + incomingRequestCount");
  });

  it("announces the unread count accessibly", () => {
    expect(header).toContain(
      "unread ${unreadNotificationCount === 1 ? \"notification\" : \"notifications\"}"
    );
  });

  it("caps both badges through one shared component, so they cannot diverge", () => {
    expect(header).toContain("function HeaderBadge(");
    const usages = header.match(/<HeaderBadge count=/g) ?? [];
    expect(usages.length).toBe(2);
  });

  it("keeps the badge inside the hit target so it cannot clip at 320px", () => {
    expect(header).toContain("-right-0.5 -top-0.5");
  });

  it("reads the canonical shell count on Home rather than a second counter", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).toContain("useUnreadNotifications()");
    expect(home).toContain("unreadNotificationCount={unreadNotificationCount}");
    // Home must not fetch the count itself.
    expect(home).not.toContain("/api/notifications/unread-count");
  });

  it("resolves the count once in the shell and shares it by context", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain("useUnreadNotificationCount(initialUnreadCount)");
    expect(shell).toContain("<UnreadNotificationProvider count={unreadCount}>");
    // The fetch/poll/broadcast logic lives in exactly one place.
    expect(shell).not.toContain("/api/notifications/unread-count");
    expect(read("hooks/use-unread-notification-count.ts")).toContain(
      "/api/notifications/unread-count"
    );
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
