import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";

/**
 * Repository invariants from the authentication/session-security audit.
 *
 * These are static checks rather than runtime ones on purpose: each guards a
 * property that is easy to reintroduce accidentally in a future change, and
 * that would not fail any ordinary feature test.
 */

const ROOT = process.cwd();
const WEB_SOURCE_DIRS = ["app", "components", "lib", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "mobile"]);

function sourceFiles(dirs: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) found.push(full);
    }
  };
  dirs.forEach((dir) => walk(join(ROOT, dir)));
  return found;
}

function readAll(files: string[]): Array<{ path: string; text: string }> {
  return files.map((path) => ({ path: relative(ROOT, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));
}

const webSources = readAll(sourceFiles(WEB_SOURCE_DIRS));

describe("client-side storage never holds credentials", () => {
  // Everything the web app is allowed to keep in local/session storage. All
  // are non-sensitive UI state; none is user-identifying on its own.
  const ALLOWED_STORAGE_KEYS = [
    "mad-buddy-theme-preference",
    "mad-buddy-accent-color",
    // The same two theme keys, written through their local constants.
    "THEME_PREFERENCE_KEY",
    "ACCENT_COLOR_KEY",
    "mad-buddy:profile-reminder-dismissed",
    "SESSION_REVISION_KEY",
    "INSTALL_CONFIRMED_KEY",
    "INSTALL_DISMISSED_AT_KEY",
    "INSTALL_SHOWN_SESSION_KEY",
    "PWA_UPDATE_ATTEMPT_KEY",
    "completedKey",
    "dismissedKey",
    "shownKey",
    "storageKey" // the local const the install keys are read through
  ];

  it("writes only approved non-sensitive keys to localStorage/sessionStorage", () => {
    const offenders: string[] = [];
    for (const { path, text } of webSources) {
      const writes = text.matchAll(/(?:localStorage|sessionStorage)\.setItem\(\s*([^,]+),/g);
      for (const match of writes) {
        const key = match[1].trim().replace(/^[`'"]|[`'"]$/g, "");
        const approved = ALLOWED_STORAGE_KEYS.some((allowed) => key.includes(allowed));
        if (!approved) offenders.push(`${path}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never persists a token, password, or service-role key from the browser", () => {
    const forbidden = /(?:localStorage|sessionStorage)\.setItem\([^)]*(?:access_token|refresh_token|password|service_role|serviceRole|secret)/i;
    const offenders = webSources.filter(({ text }) => forbidden.test(text)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("keeps the service-role key out of any client-reachable module", () => {
    // NEXT_PUBLIC_* is inlined into the browser bundle, so a service-role key
    // read through that prefix would ship to every visitor.
    const offenders = webSources
      .filter(({ text }) => /NEXT_PUBLIC_[A-Z_]*(?:SERVICE_ROLE|SECRET)/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("server-side authorisation derives identity from the server", () => {
  it("never authorises server work with getSession()", () => {
    // getSession() returns whatever is in the cookie without revalidating it
    // against Supabase, so it must never gate a server-side decision.
    // getUser() is the verified call and is what every server path uses.
    const offenders = webSources
      .filter(({ text }) => /auth\s*\.\s*getSession\s*\(/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("creates Supabase clients through the shared factories, never ad hoc at module scope", () => {
    // A module-scope client is shared across requests on a warm server, which
    // is the classic way one user's session leaks into another's request.
    const offenders = webSources
      .filter(({ path }) => !path.startsWith("lib/supabase/") && path !== "lib/api/auth.ts")
      .filter(({ text }) => /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*create(?:Browser|Server)?Client\s*[<(]/m.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("service worker never caches authenticated data", () => {
  const serviceWorker = readFileSync(join(ROOT, "public/sw.js"), "utf8");

  /* THE INVARIANT, STATED AS THE INVARIANT.
   *
   * This block used to assert `caches` was never mentioned at all. That was a
   * proxy for the real rule, and a good one while the worker cached nothing --
   * but a blanket ban cannot distinguish "caches a user's conversation" from
   * "caches a static offline page", and the second is what MB-GOD-041 needed.
   *
   * The rule being protected has not changed and is not being relaxed: a
   * cache-first strategy over an authenticated route is how one account's JSON
   * ends up rendered for the next account in a shared browser. So the test now
   * pins the exact set of URLs the worker may cache, and every other property
   * that keeps authenticated data out.
   */
  const ALLOWED_CACHE_URLS = ["/offline.html", "/offline.js"];

  it("caches ONLY the static offline shell, nothing else", () => {
    /* Read the CACHE LIST the worker actually precaches, not every string in
       the file -- notification icon paths are navigation/display assets, never
       handed to the Cache API. */
    const listMatch = serviceWorker.match(/const OFFLINE_ASSETS\s*=\s*\[([^\]]*)\]/);
    expect(listMatch, "OFFLINE_ASSETS list not found in sw.js").toBeTruthy();
    const listed = [...listMatch![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    // OFFLINE_URL is referenced by name; resolve it.
    const offlineUrl = serviceWorker.match(/const OFFLINE_URL\s*=\s*["']([^"']+)["']/)?.[1];
    const resolved = listMatch![1].includes("OFFLINE_URL") && offlineUrl
      ? [offlineUrl, ...listed]
      : listed;
    const unexpected = resolved.filter((url) => !ALLOWED_CACHE_URLS.includes(url));
    expect(unexpected, `unexpected precached URL: ${unexpected.join(", ")}`).toEqual([]);
    expect(resolved.sort()).toEqual([...ALLOWED_CACHE_URLS].sort());
  });

  it("does not open the cache anywhere outside the offline path", () => {
    /* Every caches.* call must concern the offline assets. A caches.put() of a
       fetched response, or a caches.match(event.request), would be the shape
       that leaks one account's page to the next. */
    expect(serviceWorker).not.toMatch(/caches\s*\.\s*put/);
    expect(serviceWorker).not.toMatch(/caches\s*\.\s*match\s*\(\s*event\.request/);
  });

  it("caches nothing that could carry user data", () => {
    /* The offline assets are static files checked into public/ and identical
       for every user. If either ever gained a dynamic segment, this fails. */
    for (const url of ALLOWED_CACHE_URLS) {
      expect(url).not.toMatch(/[:*[\]]|\$\{/);
    }
  });

  it("never answers a real route from the cache", () => {
    /* Navigations are network-FIRST: the cached shell is reachable only from
       the .catch() of a failed fetch. A cache-first navigation handler would
       serve a stale authenticated page, which is the defect this guards. */
    const navBlock = serviceWorker.slice(
      serviceWorker.indexOf('if (event.request.mode === "navigate")'),
      serviceWorker.indexOf("if (event.request.method !== \"GET\") return;")
    );
    expect(navBlock, "the navigation handler is missing").toContain("fetch(event.request)");
    expect(
      navBlock.indexOf("fetch(event.request)"),
      "the cache is consulted before the network"
    ).toBeLessThan(navBlock.indexOf("caches.match"));
  });

  it("never force-caches a request", () => {
    // `cache: "reload"` on the precache is the opposite: it bypasses the HTTP
    // cache to fetch a fresh copy. `force-cache` would be the dangerous one.
    expect(serviceWorker).not.toMatch(/cache\s*:\s*["']force-cache["']/);
  });

  it("passes non-navigation fetches straight through to the network", () => {
    // A trailing .catch() is allowed (it only prevents an unhandled promise
    // rejection on a blocked/offline request).
    expect(serviceWorker).toMatch(/event\.respondWith\(\s*fetch\(event\.request\)(?:\s*\.catch\([\s\S]*?\))?\s*\)/);
  });
});

describe("private responses are not publicly cacheable", () => {
  it("sets Cache-Control: private, no-store on every /api route", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(config).toMatch(/source:\s*["']\/api\/:path\*["']/);
    expect(config).toMatch(/private,\s*no-store/);
  });
});
