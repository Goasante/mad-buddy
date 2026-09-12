import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shared Notifications screen.
 *
 * The first FEATURE screen both apps render from one component. The native app
 * had its own 500-line version that rendered 3 notification types where web
 * rendered 11, with no meeting-ping replies, no undo and no stale-target
 * handling. These tests pin the seams that make one component serve both, each
 * of which would fail on a phone and nowhere else.
 */

const read = (p: string) => readFileSync(p, "utf8");
const shared = read("components/notifications/notifications-page.tsx");
const webBoundary = read("components/notifications/web-notifications-page.tsx");
const mobileScreen = read("mobile/src/screens/NotificationsScreen.tsx");
const webPage = read("app/(app)/notifications/page.tsx");
const importLines = (source: string) =>
  source.split(/\r?\n/).filter((line) => line.trimStart().startsWith("import ")).join("\n");

describe("the screen is shared, not duplicated", () => {
  it("both platforms render the same component", () => {
    expect(webBoundary).toContain('from "@/components/notifications/notifications-page"');
    expect(webBoundary).toContain("<NotificationsPageContent");
    expect(mobileScreen).toContain('from "@/components/notifications/notifications-page"');
    expect(mobileScreen).toContain("<NotificationsPageContent");
  });

  it("leaves no second implementation behind in the native app", () => {
    // The old screen carried its own filters, icon map and birthday sheet.
    // If any of it survives, the two can drift again.
    expect(mobileScreen).not.toContain("filterOptions");
    expect(mobileScreen).not.toContain("BIRTHDAY_WISHES");
    expect(mobileScreen).not.toContain("Mark all as read");
    // A screen rendering the shared component does not need 500 lines.
    expect(mobileScreen.split("\n").length).toBeLessThan(120);
  });
});

describe("the shared component reaches no web-only module", () => {
  it("imports nothing from next/*", () => {
    // next/link in particular: the platform adapter supplies Link so web keeps
    // typed routes and the native app gets a react-router link.
    expect(importLines(shared)).not.toMatch(/from\s+["']next\//);
    expect(shared).toContain('from "@/lib/platform"');
  });

  it("imports no Server Action", () => {
    // A "use server" import pulls server-only modules -- including the
    // service-role Supabase client -- into the mobile bundle.
    const imports = importLines(shared);
    expect(imports).not.toContain("@/app/");
    expect(imports).not.toContain("premium-actions");
    expect(imports).not.toContain("birthday-actions");
  });

  it("performs no fetch of its own", () => {
    // Relative paths resolve against https://localhost on a phone -- the
    // bundled asset origin, which serves no API at all.
    expect(shared).not.toContain("fetchWithTimeout(");
    expect(shared).not.toMatch(/\bfetch\(/);
    // Reached through a ref inside the polling effect, which must stay
    // single-run; either spelling satisfies the rule that matters here.
    expect(shared).toMatch(/client(Ref\.current)?\.load\(\)/);
  });
});

describe("each platform supplies its own transport", () => {
  it("web uses cookies on same-origin paths", () => {
    const web = read("lib/notifications/web-client.ts");
    expect(web).toContain('credentials: "include"');
    expect(web).toContain('"/api/notifications"');
    expect(webBoundary).toContain("createWebNotificationsClient");
  });

  it("Android uses its Bearer-token api client", () => {
    const mobile = read("mobile/src/lib/notifications-client.ts");
    expect(mobile).toContain('from "./api"');
    expect(mobileScreen).toContain("client={mobileNotificationsClient}");
  });

  it("both reach the SAME ping route, so the premium gate cannot differ", () => {
    // Web goes through respondToMeetupRequestAction and Android through
    // /api/pings/respond; both call lib/meetups/service.ts.
    expect(webBoundary).toContain("respondToMeetupRequestAction");
    expect(read("mobile/src/lib/notifications-client.ts")).toContain("/api/pings/respond");
    expect(read("app/api/pings/respond/route.ts")).toContain('from "@/lib/meetups/service"');
  });
});

describe("back behaviour stays platform-specific", () => {
  it("the shared component never imports a dismiss hook", () => {
    // The web hook calls history.back() on cleanup, which cancels an in-flight
    // App Router navigation. Correct on web, wrong on Android.
    expect(importLines(shared)).not.toContain("use-dismiss-on-back");
    expect(shared).toContain("useOverlayDismiss");
  });

  it("each platform injects its own", () => {
    expect(webBoundary).toContain("useOverlayDismiss={useDismissOnBack}");
    expect(mobileScreen).toContain("useOverlayDismiss={useOverlayDismiss}");
  });
});

describe("the quick-settings toggles persist on BOTH platforms", () => {
  it("saves rather than holding local state", () => {
    // The web screen used to keep these three switches in useState alone:
    // flipping one and reloading silently reverted it, while the native app
    // had been persisting them correctly all along.
    expect(shared).toContain("client.saveNotificationPreferences");
    expect(shared).toContain("savePreferences(");
  });

  it("reverts the switch when the save fails", () => {
    // Otherwise the UI claims a setting that was never stored.
    expect(shared).toContain("revert()");
  });

  it("clears quiet mode in the SAME patch that disables nearby alerts", () => {
    // Two separate saves could leave a contradictory pair persisted if the
    // second failed: nearby alerts off, quiet nearby on.
    expect(shared).toContain("{ nearbyAlerts: false, quietNearby: false }");
  });

  it("both platforms read the saved values before rendering", () => {
    expect(mobileScreen).toContain("initialPreferences={preferences}");
    expect(webPage).toContain("initialPreferences");
  });
});
