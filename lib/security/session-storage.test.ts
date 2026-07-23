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
    "INSTALL_CONFIRMED_KEY",
    "INSTALL_DISMISSED_AT_KEY",
    "INSTALL_SHOWN_SESSION_KEY",
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

  it("uses no Cache Storage at all", () => {
    // A cache-first strategy over an authenticated route is how one account's
    // JSON ends up rendered for the next account in a shared browser.
    expect(serviceWorker).not.toMatch(/caches\s*\.\s*(?:open|match|addAll)/);
    expect(serviceWorker).not.toMatch(/cache\s*:\s*["']force-cache["']/);
  });

  it("passes fetches straight through to the network", () => {
    expect(serviceWorker).toMatch(/event\.respondWith\(\s*fetch\(event\.request\)\s*\)/);
  });
});

describe("private responses are not publicly cacheable", () => {
  it("sets Cache-Control: private, no-store on every /api route", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(config).toMatch(/source:\s*["']\/api\/:path\*["']/);
    expect(config).toMatch(/private,\s*no-store/);
  });
});
