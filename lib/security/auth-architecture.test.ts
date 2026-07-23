import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";

/**
 * Authentication-architecture invariants (focused auth/JWT review).
 *
 * These lock the properties the review confirmed, so a future change can't
 * silently regress them: identity is Supabase-issued and server-VERIFIED
 * (never a local decode), there is no custom JWT system, the admin role is
 * read from the database rather than trusted from a JWT claim, and no
 * per-process session store exists. Static checks on purpose — none of these
 * would fail an ordinary feature test.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "mobile"]);

function sourceFiles(): string[] {
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
  SOURCE_DIRS.forEach((dir) => walk(join(ROOT, dir)));
  return found;
}

const sources = sourceFiles().map((path) => ({
  path: relative(ROOT, path).split(sep).join("/"),
  text: readFileSync(path, "utf8")
}));

describe("identity is Supabase-issued, not a custom JWT system", () => {
  it("depends on no custom JWT library", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ["jsonwebtoken", "jose", "jwt-simple", "njwt", "fast-jwt"]) {
      expect(all).not.toHaveProperty(banned);
    }
  });

  it("never signs or hand-verifies a JWT itself", () => {
    // Supabase issues and verifies tokens. The app must not mint or locally
    // verify one — that would be a parallel, unaudited auth system.
    const forbidden = /\b(?:jwt\.sign|jwt\.verify|new\s+SignJWT|jwtVerify|createSigner|createVerifier)\b/;
    const offenders = sources.filter(({ text }) => forbidden.test(text)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("tokens are verified server-side, not merely decoded", () => {
  it("the API auth resolver verifies the bearer token via getUser(token)", () => {
    const apiAuth = sources.find(({ path }) => path === "lib/api/auth.ts");
    expect(apiAuth, "lib/api/auth.ts should exist").toBeTruthy();
    // getUser(token) is a round trip that validates the token with Supabase;
    // a bare jwtDecode/atob of the token would be trust-without-verification.
    expect(apiAuth!.text).toMatch(/getUser\(\s*token\s*\)/);
  });

  it("never decodes a token locally and trusts it", () => {
    const forbidden = /(?:jwtDecode|jwt_decode|decodeJwt)\s*\(|atob\([^)]*token/i;
    const offenders = sources.filter(({ text }) => forbidden.test(text)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("the admin role cannot be forged from a token", () => {
  it("reads the role from the admin_users table, not a JWT claim", () => {
    const access = sources.find(({ path }) => path === "lib/admin/access.ts");
    expect(access, "lib/admin/access.ts should exist").toBeTruthy();
    expect(access!.text).toMatch(/from\(["']admin_users["']\)/);
  });

  it("never derives a privileged role from user/app_metadata JWT claims", () => {
    // app_metadata/user_metadata ride inside the JWT; trusting a role from
    // there would let a tampered token escalate. Role comes from the DB.
    const forbidden = /(?:user_metadata|app_metadata)(?:\?\.|\.)\s*role\b/;
    const offenders = sources.filter(({ text }) => forbidden.test(text)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("no per-process session store (multi-instance safety)", () => {
  it("keeps no module-level mutable map or object of users/sessions", () => {
    // A module-scoped sessions[userId] / Map<id,user> / currentUser would be
    // wrong the moment a second Vercel instance serves a request. Identity is
    // re-derived per request from the cookie/bearer session instead.
    const forbidden =
      /^(?:export\s+)?(?:const|let|var)\s+\w*(?:session|currentUser|userCache)\w*\s*[:=]\s*(?:new\s+Map|\{|\[)/im;
    const offenders = sources
      // The per-request React cache() in supabase/auth.ts is request-scoped,
      // not a module-level store, and is the sanctioned dedupe path.
      .filter(({ path }) => path !== "lib/supabase/auth.ts")
      .filter(({ text }) => forbidden.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
