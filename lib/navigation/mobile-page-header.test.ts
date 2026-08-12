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
    expect(header).toMatch(/<h1[^>]*text-center/);
    // The leading slot is always occupied — an empty spacer when there is no
    // action — so the centred title cannot drift.
    expect(header).toContain('<span className="h-11 w-11" aria-hidden="true" />');
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
    // One shared constant rather than hand-written class strings.
    expect(header).toContain("const HIT_TARGET");
    expect(header).toContain("h-11 w-11");
    // Add Muddy composes the same constant rather than restyling itself.
    expect(header).toMatch(/cn\(\s*HIT_TARGET,/);
  });

  it("uses one optical size and one stroke weight for every icon", () => {
    expect(header).toContain('const ICON = "h-[22px] w-[22px]"');
    expect(header).toContain("const STROKE = 1.75");
    // Every icon except Add Muddy's (which is optically matched at a heavier
    // stroke against its filled background) uses the shared constant, and none
    // hardcodes its own size alongside it: Menu, Back-as-link, Back-as-button,
    // Bell and Quick Controls.
    const iconUsages = header.match(/className=\{ICON\}/g) ?? [];
    expect(iconUsages.length).toBe(5);
  });

  it("uses only the specified Lucide icons", () => {
    // ChevronLeft is the Back affordance for the nested-screen variant.
    expect(header).toContain(
      'import { Bell, ChevronLeft, Menu, MoreHorizontal, UserPlus } from "lucide-react"'
    );
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

  it("is used by every bottom-nav root", () => {
    for (const [path, title] of [
      ["components/dashboard/dashboard-page.tsx", "Home"],
      ["components/friends/friends-page.tsx", "Muddies"],
      ["components/plans/plans-page.tsx", "Plans"],
      ["components/profile/profile-page.tsx", "Me"]
    ] as const) {
      const source = read(path);
      expect(source, `${path} should use the shared header`).toContain("<MobilePageHeader");
      expect(source, `${path} should carry its product-facing title`).toContain(`title="${title}"`);
    }
  });

  it("keeps Quick Controls on Home alone", () => {
    // Its sheet is Home-specific (visibility, ghost mode, refresh Nearby).
    for (const path of [
      "components/friends/friends-page.tsx",
      "components/plans/plans-page.tsx",
      "components/profile/profile-page.tsx"
    ]) {
      expect(read(path), `${path} must not show Quick Controls`).toContain("showQuickControls={false}");
    }
    expect(read("components/dashboard/dashboard-page.tsx")).not.toContain("showQuickControls={false}");
  });

  it("stands the global AppHeader down wherever a page renders its own", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    const list = shell.slice(shell.indexOf("const PAGES_WITH_OWN_HEADER"), shell.indexOf("function hasOwnHeader"));
    for (const route of ["/dashboard", "/friends", "/plans", "/profile"]) {
      expect(list, `${route} would otherwise render two headers`).toContain(`"${route}"`);
    }
  });

  it("hides the duplicate in-page title on mobile only", () => {
    // Desktop has no mobile header, so it keeps its own h1.
    for (const path of ["components/plans/plans-page.tsx", "components/profile/profile-page.tsx"]) {
      expect(read(path)).toContain('className="hidden text-2xl font-semibold tracking-tight md:block');
    }
  });
});

describe("stage 1b rollout", () => {
  /** [file, title, expected variant] */
  const MIGRATED = [
    ["components/messages/messages-page.tsx", "Messages", "root"],
    ["components/content/moments-page.tsx", "Moments", "root"],
    ["components/events/events-page.tsx", "Events", "root"],
    // Product name: Groups became Circles. The route and every internal
    // identifier stay `group*` on purpose -- only what the person reads moved.
    ["components/groups/groups-page.tsx", "Circles", "root"],
    ["components/settings/settings-page.tsx", "Settings", "root"],
    ["components/notifications/notifications-page.tsx", "Pulse", "root"],
    ["components/invites/invites-page.tsx", "Invites", "root"],
    ["components/drops/drops-page.tsx", "Muddy Drops", "root"],
    ["components/meeting-pings/meeting-pings-page.tsx", "Meeting Pings", "root"],
    ["components/reminders/reminders-page.tsx", "Reminders", "root"],
    ["components/premium/billing-page.tsx", "Membership", "back"],
    ["components/buddy-score/buddy-score-page.tsx", "My Progress", "back"],
    ["components/scan/scan-page.tsx", "Scan a code", "back"],
    ["components/safety/safe-arrival-page.tsx", "Safe Arrival", "back"]
  ] as const;

  it("migrates every listed screen to the shared header", () => {
    for (const [path, title] of MIGRATED) {
      const source = read(path);
      expect(source, `${path} should use the shared header`).toContain("<PageHeader");
      expect(source, `${path} title`).toContain(`title="${title}"`);
    }
  });

  it("uses the product-facing names, not route names", () => {
    expect(read("components/notifications/notifications-page.tsx")).toContain('title="Pulse"');
    expect(read("components/buddy-score/buddy-score-page.tsx")).toContain('title="My Progress"');
    expect(read("components/drops/drops-page.tsx")).toContain('title="Muddy Drops"');
  });

  it("gives nested screens Back and root screens Menu", () => {
    for (const [path, , variant] of MIGRATED) {
      const source = read(path);
      if (variant === "back") {
        expect(source, `${path} should be a nested screen`).toMatch(/backHref="\/[a-z-]+"/);
      } else {
        expect(source, `${path} should be a root screen`).not.toContain("backHref");
      }
    }
  });

  it("hides the duplicate mobile title on every migrated screen", () => {
    for (const [path] of MIGRATED) {
      expect(read(path), `${path} should hide its mobile h1`).toMatch(/<h1[^>]*className="[^"]*hidden/);
    }
  });

  it("stands the global AppHeader down for every migrated route", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    const list = shell.slice(shell.indexOf("const PAGES_WITH_OWN_HEADER"), shell.indexOf("function hasOwnHeader"));
    for (const route of [
      "/messages", "/moments", "/events", "/groups", "/settings", "/notifications",
      "/invites", "/drops", "/meeting-pings", "/reminders", "/billing",
      "/buddy-score", "/scan", "/safe-arrival"
    ]) {
      expect(list, `${route} would otherwise render two headers`).toContain(`"${route}"`);
    }
  });

  it("hides the Bell on Pulse, which IS the notifications stream", () => {
    expect(read("components/notifications/notifications-page.tsx")).toContain("showNotifications={false}");
  });

  it("keeps the shared header out of an open conversation", () => {
    // A Menu button has no place inside a conversation, and the conversation
    // keeps its own contextual header (participant identity, mute, info).
    const messages = read("components/messages/messages-page.tsx");
    expect(messages).toContain('<div className={cn(selectedId && "hidden")}>');
    expect(messages).toContain("Back to conversations");
  });

  it("removes the duplicate back control on Membership", () => {
    // The in-page "Home" button survives on desktop only.
    expect(read("components/premium/billing-page.tsx")).toContain('className="hidden md:inline-flex"');
  });

  it("routes every screen through one wrapper rather than a second header", () => {
    const wrapper = read("components/app-shell/page-header.tsx");
    expect(wrapper).toContain("<MobilePageHeader");
    expect(wrapper).toContain("useAppMenu()");
    expect(wrapper).toContain("useUnreadNotifications()");
    // Quick Controls is Home's alone.
    expect(wrapper).toContain("showQuickControls={false}");
  });
});

describe("layout identity queries", () => {
  const layout = read("app/(app)/layout.tsx");

  it("runs the identity loads in the existing parallel batch", () => {
    const start = layout.indexOf("const [adminContext");
    const batch = layout.slice(start, layout.indexOf("]);", start));
    expect(batch).toContain("await Promise.all([");
    // Both new loads live inside that one batch, adding no serial latency.
    expect(batch).toContain("loadBuddyScoreLevel");
    expect(batch).toContain("bio, mood_status");
  });

  it("loads the Buddy Score level exactly once app-wide", () => {
    const callSites = layout.match(/loadBuddyScoreLevel\(/g) ?? [];
    expect(callSites.length).toBe(1);
    expect(read("app/(app)/dashboard/page.tsx")).not.toContain("loadBuddyScoreLevel");
  });

  it("guards both loads on the server env, so a missing config cannot throw", () => {
    expect(layout).toContain("user && env.url && env.serviceRoleKey");
  });

  it("degrades to a base level rather than failing the shell", () => {
    // loadBuddyScoreLevel ignores the query error and falls back to `[]`.
    expect(read("lib/engagement/buddy-score-service.ts")).toContain("calculateBuddyScoreTotal(data ?? [])");
  });
});

describe("mobile page header variants", () => {
  it("supports menu, back and none in the leading slot", () => {
    expect(header).toContain('leadingAction?: "menu" | "back" | "none"');
    expect(header).toContain('leadingAction === "back" && backHref');
    expect(header).toContain('leadingAction === "back" && onBack');
  });

  it("prefers a real link for Back so it survives a cold load", () => {
    expect(header).toContain("backHref?: Route");
    expect(header).toContain('<HeaderLink href={backHref} label="Back">');
  });

  it("lets a screen turn off trailing actions that do not apply to it", () => {
    for (const flag of ["showNotifications", "showAddMuddy", "showQuickControls"]) {
      expect(header).toContain(`${flag}?: boolean`);
      expect(header).toContain(`{${flag}`);
    }
  });

  it("defaults the trailing actions on, so root screens need no configuration", () => {
    expect(header).toContain("showNotifications = true");
    expect(header).toContain("showAddMuddy = true");
    expect(header).toContain("showQuickControls = true");
  });

  it("takes no arbitrary styling from screens", () => {
    // A controlled API: no className/style escape hatch on the header itself.
    expect(header).not.toMatch(/^\s*className\?: string;/m);
    expect(header).not.toContain("style?: CSSProperties");
  });
});

describe("app menu sheet", () => {
  it("is mounted once in the shell rather than per screen", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain("<HomeSettingsSheet");
    expect(shell).toContain("<AppMenuProvider openMenu={() => setAppMenuOpen(true)}>");
    // Home no longer keeps its own copy.
    expect(read("components/dashboard/dashboard-page.tsx")).not.toContain("<HomeSettingsSheet");
  });

  it("lets any screen open it without receiving identity props", () => {
    for (const path of [
      "components/dashboard/dashboard-page.tsx",
      "components/friends/friends-page.tsx",
      "components/plans/plans-page.tsx",
      "components/profile/profile-page.tsx"
    ]) {
      expect(read(path), `${path} should open the shared menu`).toContain("useAppMenu()");
    }
  });

  it("resolves its identity once in the layout", () => {
    const layout = read("app/(app)/layout.tsx");
    expect(layout).toContain("loadBuddyScoreLevel");
    expect(layout).toContain("profileCompletionPercent(profileResult.data)");
    // Home's duplicate level load is gone, so the ledger is read once.
    expect(read("app/(app)/dashboard/page.tsx")).not.toContain("loadBuddyScoreLevel");
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
