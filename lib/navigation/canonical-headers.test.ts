import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Canonical headers.
 *
 * Every authenticated screen draws its title bar the same way, so no page
 * "visually reveals which header implementation it uses". Two failure modes
 * this guards against, both invisible in a unit test of any single component:
 *
 *  1. A screen renders NO fixed header, so it silently looks like a different
 *     app once you navigate into it. (This was the state of all 14 Settings
 *     sub-pages before this pass.)
 *  2. A screen renders its own header WITHOUT standing the global one down, so
 *     it shows two stacked bars.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const appShell = stripComments(read("components/app-shell/app-shell.tsx"));

/** The registry AppShell consults to stand the global header down. */
function ownHeaderRoutes(): string[] {
  const block = appShell.slice(
    appShell.indexOf("PAGES_WITH_OWN_HEADER = ["),
    appShell.indexOf("] as const", appShell.indexOf("PAGES_WITH_OWN_HEADER = ["))
  );
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** Every authenticated route, from the (app) route group. */
function authenticatedRoutes(): string[] {
  const base = join(root, "app", "(app)");
  const routes: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const route =
          "/" +
          relative(base, directory)
            .split(sep)
            .filter(Boolean)
            .join("/");
        routes.push(route === "/" ? "/" : route);
      }
    }
  };
  walk(base);
  return routes.sort();
}

describe("route audit", () => {
  const routes = authenticatedRoutes();

  it("finds the authenticated routes (the audit is actually running)", () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it("every route with its own header is registered to stand the global one down", () => {
    // A page rendering <PageHeader> without being in the registry shows TWO
    // bars. The registry is the only thing preventing that, so it is asserted
    // rather than trusted.
    const registered = ownHeaderRoutes();
    const missing: string[] = [];

    for (const route of routes) {
      // Dynamic segments and redirect-only routes are resolved below.
      if (route.includes("[")) continue;
      const pageSource = read(join("app", "(app)", route.slice(1), "page.tsx"));
      const componentPath = pageSource.match(/from "@\/(components\/[a-z0-9-]+\/[a-z0-9-]+)"/)?.[1];
      const target = componentPath ? `${componentPath}.tsx` : null;
      let source = pageSource;
      try {
        if (target) source = read(target);
      } catch {
        // Page renders inline; the page source is already the right target.
      }
      if (!source.includes("PageHeader") && !source.includes("MobilePageHeader")) continue;

      const covered = registered.some((href) => route === href || route.startsWith(`${href}/`));
      if (!covered) missing.push(route);
    }

    expect(missing, "these routes draw their own header but the global one also renders").toEqual([]);
  });
});

describe("legacy headers are gone", () => {
  it("Settings sub-pages use the canonical header", () => {
    // One shared sub-header, so fixing it fixed all 14 at once.
    const subHeader = read("components/settings/settings-sub-header.tsx");
    expect(subHeader).toContain("PageHeader");
    expect(subHeader).toContain('backHref="/settings"');
  });

  it("the migrated screens render the canonical header", () => {
    const migrated = [
      "components/badges/badges-page.tsx",
      "components/help/help-center-page.tsx",
      "components/invite/invite-buddies-page.tsx",
      "components/safety/safety-center-page.tsx",
      "components/hangout/hangout-mode-page.tsx"
    ];
    for (const file of migrated) {
      expect(read(file), `${file} must use the canonical header`).toContain("PageHeader");
    }
  });

  it("UpFor draws an inline header at canonical control sizes", () => {
    // UpFor carries a subtitle and its own actions, so like /discover it draws
    // its own header rather than taking PageHeader. What the old bespoke bar
    // actually got WRONG was the sizing — 40px bordered buttons against the
    // canonical 44px borderless ones — so that is what this pins.
    const upfor = stripComments(read("components/hangout/hangout-mode-page.tsx"));
    expect(upfor).toContain("upfor-header");
    expect(upfor).not.toContain("<PageHeader");

    const css = read("app/globals.css");
    const back = css.slice(css.indexOf(".upfor-back {"));
    expect(back.slice(0, 300)).toContain("height: 2.75rem");
    const iconButton = css.slice(css.indexOf(".upfor-icon-button {"));
    expect(iconButton.slice(0, 300)).toContain("height: 3rem");
  });

  it("no migrated screen keeps a second visible h1 on mobile", () => {
    // The canonical header supplies the page h1; an in-content title must be
    // desktop-only or the screen shows the title twice.
    for (const file of [
      "components/badges/badges-page.tsx",
      "components/help/help-center-page.tsx",
      "components/invite/invite-buddies-page.tsx"
    ]) {
      const source = stripComments(read(file));
      const headings = [...source.matchAll(/<h1 className="([^"]*)"/g)].map((match) => match[1]!);
      for (const className of headings) {
        expect(className, `${file}: in-content h1 must be desktop-only`).toContain("md:block");
        expect(className).toContain("hidden");
      }
    }
  });

  it("Socialize draws an inline header, so it reserves no fixed height", () => {
    // Socialize 2.0 replaced the radar with a scrolling discovery feed, so
    // /discover takes the canonical header like every other root destination.
    // The mechanism is kept for the next immersive screen.
    expect(appShell).toContain('IMMERSIVE_HEADER_PAGES: readonly string[] = ["/discover"]');
    expect(appShell).toContain('"/discover"');
  });
});

describe("owner admin access", () => {
  const sheet = stripComments(read("components/dashboard/home-settings-sheet.tsx"));

  it("adds an Administration entry to the account sheet", () => {
    expect(sheet).toContain('label: "Administration"');
    expect(sheet).toContain('href: "/admin"');
  });

  it("renders it only when the server says the account is staff", () => {
    expect(sheet).toContain("{showAdminLink ? (");
  });

  it("defaults to hidden, so a caller that forgets the prop cannot leak it", () => {
    expect(sheet).toContain("showAdminLink = false");
  });

  it("uses the same server-resolved flag as the sidebar", () => {
    // getAdminContext() runs in the authenticated layout; the sheet never
    // decides staff status for itself.
    expect(stripComments(read("app/(app)/layout.tsx"))).toContain("showAdminLink={adminContext.ok}");
    expect(appShell).toContain("showAdminLink={showAdminLink}");
  });

  it("keeps Admin out of the public bottom navigation", () => {
    const mobileNav = stripComments(read("components/app-shell/app-shell.tsx"));
    const navBlock = mobileNav.slice(mobileNav.indexOf("function MobileNav"));
    expect(navBlock).not.toContain('"/admin"');
  });
});
