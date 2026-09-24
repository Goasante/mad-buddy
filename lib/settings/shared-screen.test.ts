import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBuiltForMobile, toMobilePath } from "@/lib/platform/routes.mobile";

/**
 * The shared Settings screen.
 *
 * The second feature screen both apps render from one component. The native
 * app had its own 280-line version offering about 10 rows where web offers 24
 * — no Appearance, Language & Region, Glow & Visibility, Data & Storage,
 * Badges or Sessions.
 *
 * The hazard here is different from Notifications. Most of what Settings does
 * is LINK somewhere, and 13 of its destinations are real web features with no
 * native screen. Left alone, each renders as a tappable row that reaches the
 * SPA catch-all — the PR #90 defect, at twice the scale.
 */

const read = (p: string) => readFileSync(p, "utf8");
const shared = read("components/settings/settings-page.tsx");
const webBoundary = read("components/settings/web-settings-page.tsx");
const mobileScreen = read("mobile/src/screens/SettingsScreen.tsx");
const importLines = (source: string) =>
  source.split(/\r?\n/).filter((line) => line.trimStart().startsWith("import ")).join("\n");

/** Every destination the shared screen can link to. */
const destinations = [...shared.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);

describe("the screen is shared, not duplicated", () => {
  it("both platforms render the same component", () => {
    expect(webBoundary).toContain('from "@/components/settings/settings-page"');
    expect(webBoundary).toContain("<SettingsPageContent");
    expect(mobileScreen).toContain('from "@/components/settings/settings-page"');
    expect(mobileScreen).toContain("<SettingsPageContent");
  });

  it("leaves no second implementation behind in the native app", () => {
    // The old screen carried its own rows, cards and section titles.
    expect(mobileScreen).not.toContain("function SectionTitle");
    expect(mobileScreen).not.toContain("function Row(");
    expect(mobileScreen).not.toContain('title="Ghost Mode"');
    // A screen rendering the shared component does not need 280 lines.
    expect(mobileScreen.split("\n").length).toBeLessThan(200);
  });
});

describe("the shared component reaches no web-only module", () => {
  it("imports nothing from next/*", () => {
    // Including next/dynamic, which is as much a part of the Next runtime as
    // next/navigation. React.lazy is the portable equivalent.
    expect(importLines(shared)).not.toMatch(/from\s+["']next\//);
    expect(shared).toContain('from "@/lib/platform"');
  });

  it("imports no Server Action", () => {
    // A "use server" import drags next/headers, lib/supabase/server and the
    // service-role client into the mobile bundle — the PR #84 failure.
    const imports = importLines(shared);
    expect(imports).not.toContain("@/app/");
    expect(imports).not.toContain("settings-actions");
  });

  it("does not import PageHeader, which reaches next/navigation", () => {
    // PR #90's crash: PageHeader -> MobilePageHeader -> useRouter, which
    // throws "invariant expected app router to be mounted" in the native app.
    expect(importLines(shared)).not.toContain("app-shell/page-header");
    expect(shared).toContain("{header}");
    expect(webBoundary).toContain('header={<PageHeader title="Settings" />}');
  });

  it("does not import the delete-account modal", () => {
    // It imports deleteAccountAction, and a lazy() import is still an import:
    // the module stays in the graph and the "use server" chunk would be built
    // for the native bundle too.
    expect(importLines(shared)).not.toContain("delete-account-modal");
    expect(webBoundary).toContain("delete-account-modal");
  });
});

describe("each platform supplies its own transport", () => {
  it("web calls its Server Actions", () => {
    expect(webBoundary).toContain("updateVisibilityStatusAction");
    expect(webBoundary).toContain("updateNotificationPreferenceAction");
  });

  it("Android uses its Bearer-token api client", () => {
    const client = read("mobile/src/lib/settings-client.ts");
    expect(client).toContain('from "./api"');
    expect(client).toContain("/api/settings/visibility");
    expect(client).toContain("/api/settings/notifications");
    expect(mobileScreen).toContain("client={mobileSettingsClient}");
  });

  it("both reach the same service, so validation cannot differ", () => {
    expect(read("app/api/settings/visibility/route.ts")).toContain('from "@/lib/settings/service"');
    expect(read("app/api/settings/notifications/route.ts")).toContain('from "@/lib/settings/service"');
  });
});

describe("rows only navigate where Android can arrive", () => {
  it("finds the destinations to check", () => {
    // Guards the regex: a silent zero-match would make the assertions below
    // vacuously pass.
    expect(destinations.length).toBeGreaterThan(20);
  });

  it("Android gates every row through isBuiltForMobile", () => {
    expect(mobileScreen).toContain("isDestinationAvailable={isBuiltForMobile}");
  });

  it("web gates nothing, because every destination exists there", () => {
    expect(webBoundary).not.toContain("isDestinationAvailable");
  });

  it("a row with no native screen renders as a BUTTON, not a dimmed link", () => {
    // aria-disabled on an anchor still lets it be followed: the row would look
    // unavailable and navigate anyway. Same reasoning as the disabled nav tabs.
    expect(shared).toContain('aria-disabled="true"');
    expect(shared).toContain("Not in the Android app yet.");
  });

  it("says why in the accessible name, not only visually", () => {
    // Dimming alone says nothing to a screen reader.
    expect(shared).toMatch(/aria-label=\{`\$\{title\}\. Not in the Android app yet\.`\}/);
  });

  it("every destination is either reachable on Android or listed as not built", () => {
    /* The invariant that matters. If someone adds a row pointing at a route the
       SPA lacks and forgets MOBILE_ROUTES_NOT_BUILT, it would render as a
       tappable link to the catch-all. */
    const nativeRoutes = new Set([
      "/home", "/muddies", "/messages", "/plans", "/events", "/moments",
      "/notifications", "/groups", "/pings", "/safety", "/subscription",
      "/socialize", "/profile", "/settings", "/settings/notifications",
      "/buddy-score", "/help", "/more", "/privacy", "/terms", "/onboarding"
    ]);
    for (const href of destinations) {
      if (!isBuiltForMobile(href)) continue; // correctly dimmed
      const mapped = toMobilePath(href).split("?")[0];
      expect(
        nativeRoutes.has(mapped),
        `${href} -> ${mapped} is neither a native route nor listed in MOBILE_ROUTES_NOT_BUILT`
      ).toBe(true);
    }
  });

  it("all 19 unavailable destinations are listed as not built", () => {
    /* The full set, counted from the screen rather than from the entries this
       PR happened to add: 13 settings-related pages, /about, and the three
       that were already listed. An earlier count said 13 because it looked
       only at the new additions. */
    const unavailable = [
      "/settings/appearance", "/settings/communication", "/settings/data-storage",
      "/settings/engagement", "/settings/feedback", "/settings/glow-visibility",
      "/settings/language", "/settings/privacy", "/settings/privacy-setup",
      "/settings/sessions", "/settings/walkthrough", "/invite", "/reminders",
      "/settings/verification", "/settings/account-status",
      "/about",
      // Pre-existing, listed before this PR.
      "/hangout-mode", "/badges", "/safety-center"
    ];
    expect(unavailable).toHaveLength(19);
    for (const href of unavailable) {
      expect(isBuiltForMobile(href), `${href} should be marked not built`).toBe(false);
    }
    // And the count is what the screen actually renders, not a stale constant.
    const distinct = [...new Set(destinations)];
    expect(distinct.filter((href) => !isBuiltForMobile(href))).toHaveLength(19);
    expect(distinct).toHaveLength(26);
  });
});

/**
 * PR #91 review findings. Every one of these passed CI, both production builds
 * and the existing gates: they are RUNTIME failures on Capacitor, which is the
 * class those gates do not cover.
 *
 * The shape of the mistake was auditing the shared component's own imports and
 * stopping there. What a component PULLS IN makes requests too.
 */
describe("no shared Settings control makes a request Android cannot authenticate", () => {
  const exportButton = read("components/settings/data-export-button.tsx");
  const locationSetting = read("components/settings/location-for-glow-setting.tsx");

  it("the export button no longer fetches a relative path itself", () => {
    // It called "/api/account/export" with credentials: "include". On
    // Capacitor that resolves against https://localhost -- which serves no API
    // -- and the cookie is meaningless where the session is a Bearer token.
    expect(exportButton).not.toContain("/api/account/export");
    expect(exportButton).not.toContain('credentials: "include"');
    expect(exportButton).toContain("onExport");
  });

  it("the location setting no longer fetches a relative path itself", () => {
    expect(locationSetting).not.toContain("/api/location/update");
    expect(locationSetting).not.toContain('credentials: "include"');
    expect(locationSetting).toContain("onEnable");
  });

  it("web keeps the cookie-authenticated implementations, unchanged", () => {
    const webClient = read("lib/settings/web-client.ts");
    expect(webClient).toContain("/api/account/export");
    expect(webClient).toContain("/api/location/update");
    expect(webClient).toContain('credentials: "include"');
  });

  it("Android enables location through its Bearer-token client", () => {
    const client = read("mobile/src/lib/settings-client.ts");
    expect(client).toContain("postCurrentLocation");
    expect(client).toContain("enableLocationForGlow");
  });

  it("Android supplies NO export, so the row renders unavailable", () => {
    /* Deliberate: the route is cookie-only (no resolveApiUser, no CORS) AND
       the web flow delivers the file with <a download>, which a WebView
       ignores. Wiring only the request would produce a control that appears to
       work and silently delivers nothing. */
    const client = read("mobile/src/lib/settings-client.ts");
    expect(client).not.toContain("exportAccountData:");
    expect(shared).toContain("client.exportAccountData ?");
    expect(shared).toContain("<UnavailableRow icon={Download}");
  });
});

describe("the Danger zone is suppressed where it would do nothing", () => {
  it("renders only when a delete modal is injected", () => {
    /* The button only sets `deleteOpen`. With no modal it did nothing at all
       -- a dead control sitting directly above Android's working native
       deletion section, so both broken and a duplicate. */
    expect(shared).toContain("{renderDeleteAccountModal ? (");
    const dangerZone = shared.slice(shared.indexOf("Danger zone") - 400, shared.indexOf("Danger zone") + 100);
    expect(dangerZone).toContain("renderDeleteAccountModal ?");
  });

  it("Android injects none, and deletes through its footer instead", () => {
    expect(mobileScreen).not.toContain("renderDeleteAccountModal");
    expect(mobileScreen).toContain("Delete my account");
  });

  it("web injects one, so its Danger zone still renders", () => {
    expect(webBoundary).toContain("renderDeleteAccountModal={");
  });
});

describe("account actions stay native", () => {
  it("Android keeps sign out and in-app deletion", () => {
    // Both stores require in-app deletion for apps that create accounts, and
    // web's Settings has neither: it signs out from the account menu.
    expect(mobileScreen).toContain("Sign out");
    expect(mobileScreen).toContain("Delete my account");
    expect(mobileScreen).toContain("footer={");
  });

  it("Android signs out AFTER deleting, to unregister the push token", () => {
    // Order matters: a deleted user's device would otherwise keep receiving
    // notifications.
    const onDeleted = mobileScreen.slice(mobileScreen.indexOf("onDeleted={"), mobileScreen.indexOf("onDeleted={") + 400);
    expect(onDeleted).toContain("signOut()");
    expect(onDeleted.indexOf("signOut()")).toBeLessThan(onDeleted.indexOf("navigate("));
  });

  it("the second confirmation step survives the migration", () => {
    // A single destructive tap on a phone is too easy to hit by accident.
    expect(mobileScreen).toContain('useState<"idle" | "confirm">');
    expect(mobileScreen).toContain("Delete your account permanently?");
  });
});
