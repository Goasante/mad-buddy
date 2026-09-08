import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE IDENTITY / AUTHORITATIVE SPLIT.
 *
 * The two helpers answer different questions and one of them is materially
 * weaker, so the difference is proved against a real auth server rather than
 * reasoned about. Every claim in the module docstring is checked here.
 *
 * The security-relevant facts, all measured below:
 *
 *   - a globally signed-out token is REJECTED by getUser and ACCEPTED by
 *     getClaims until it expires;
 *   - RLS does NOT close that window -- PostgREST still serves rows for a
 *     signed-out token, so "RLS protects it" is not a valid justification for
 *     choosing the identity path;
 *   - `ban_duration` is not enforced by either, so this split neither fixes
 *     nor regresses bans.
 */

try {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: the isLocal guard below skips the suite.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const DB_TIMEOUT = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const madeUsers: string[] = [];

/** A throwaway account, so revocation tests never touch shared fixtures. */
async function freshUser() {
  const email = `auth-split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "HardeningPass123!",
    email_confirm: true
  });
  if (error) throw new Error(`create user: ${error.message}`);
  madeUsers.push(data.user.id);

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await anon.auth.signInWithPassword({ email, password: "HardeningPass123!" });
  if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);
  return { anon, userId: data.user.id, token: signIn.data.session.access_token };
}

beforeAll(async () => {
  if (!isLocal) return;
  ({ createClient } = await import("@supabase/supabase-js"));
  admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
});

afterAll(async () => {
  if (!isLocal) return;
  for (const id of madeUsers) await admin.auth.admin.deleteUser(id).catch(() => {});
});

describeLocal("identity: what a verified JWT proves", () => {
  it(
    "a valid ES256 token is accepted and yields the subject",
    async () => {
      const { anon, token, userId } = await freshUser();
      const result = await anon.auth.getClaims(token);

      expect(result.error).toBeFalsy();
      expect(result.data?.claims?.sub).toBe(userId);
    },
    DB_TIMEOUT
  );

  it(
    "a tampered payload is rejected",
    async () => {
      const { anon, token } = await freshUser();
      const [header, payload, signature] = token.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      claims.sub = "00000000-0000-4000-8000-000000000000";
      const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");

      const result = await anon.auth.getClaims(`${header}.${forged}.${signature}`);
      expect(Boolean(result.error) || !result.data).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "a bad signature is rejected",
    async () => {
      const { anon, token } = await freshUser();
      const [header, payload] = token.split(".");

      const result = await anon.auth.getClaims(`${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
      expect(Boolean(result.error) || !result.data).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "a malformed token is rejected",
    async () => {
      const { anon } = await freshUser();
      const result = await anon.auth.getClaims("not.a.jwt");
      expect(Boolean(result.error) || !result.data).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "an expired token is rejected",
    async () => {
      const { anon, token } = await freshUser();
      const [header, payload, signature] = token.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      claims.exp = Math.floor(Date.now() / 1000) - 60;
      const stale = Buffer.from(JSON.stringify(claims)).toString("base64url");

      const result = await anon.auth.getClaims(`${header}.${stale}.${signature}`);
      expect(Boolean(result.error) || !result.data).toBe(true);
    },
    DB_TIMEOUT
  );
});

describeLocal("authoritative: what only a fresh lookup sees", () => {
  it(
    "a normal session is accepted",
    async () => {
      const { anon, token, userId } = await freshUser();
      const result = await anon.auth.getUser(token);

      expect(result.error).toBeFalsy();
      expect(result.data.user?.id).toBe(userId);
    },
    DB_TIMEOUT
  );

  it(
    "a globally signed-out session is rejected -- and the identity path is NOT",
    async () => {
      const { anon, token } = await freshUser();
      await admin.auth.admin.signOut(token, "global");

      const authoritative = await anon.auth.getUser(token);
      const identity = await anon.auth.getClaims(token);

      expect(authoritative.error, "getUser must notice a global sign-out").toBeTruthy();
      /* Documented, not desired: this is the ≤60 minute window the split
         accepts on purpose, and the reason privileged paths must not use it. */
      expect(identity.error, "getClaims cannot see revocation -- window is real").toBeFalsy();
    },
    DB_TIMEOUT
  );

  it(
    "a deleted user is rejected -- and the identity path is NOT",
    async () => {
      const { anon, token, userId } = await freshUser();
      await admin.auth.admin.deleteUser(userId);

      const authoritative = await anon.auth.getUser(token);
      const identity = await anon.auth.getClaims(token);

      expect(authoritative.error, "getUser must notice deletion").toBeTruthy();
      expect(identity.error).toBeFalsy();
    },
    DB_TIMEOUT
  );

  it(
    "RLS does NOT close the window: a signed-out token still reads rows",
    async () => {
      /* The assumption this suite exists to destroy. "RLS protects it" was the
         obvious justification for putting service-role paths on the identity
         helper; it is false, so the justification has to be an independent
         per-request authorization check instead. */
      const { token, userId } = await freshUser();
      await admin.from("profiles").insert({
        user_id: userId,
        username: `split${Date.now().toString().slice(-8)}`,
        full_name: "Split Probe"
      });

      const asUser = () =>
        createClient(url, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false }
        });

      const before = await asUser().from("profiles").select("user_id").limit(1);
      expect(before.error).toBeFalsy();

      await admin.auth.admin.signOut(token, "global");

      const after = await asUser().from("profiles").select("user_id").limit(1);
      expect(after.error, "PostgREST still accepts a signed-out JWT").toBeFalsy();
    },
    DB_TIMEOUT
  );

  it(
    "a ban is enforced by NEITHER, so this split does not change ban behaviour",
    async () => {
      /* Recorded so nobody later claims getCurrentUserRecord solves bans.
         Mad Buddy's own restriction checks are what enforce them. */
      const { anon, token, userId } = await freshUser();
      await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });

      const authoritative = await anon.auth.getUser(token);
      const identity = await anon.auth.getClaims(token);

      expect(authoritative.error).toBeFalsy();
      expect(identity.error).toBeFalsy();

      await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    },
    DB_TIMEOUT
  );
});

describe("no fabricated Supabase User survives", () => {
  const SOURCE = readFileSync("lib/supabase/auth.ts", "utf8").replace(/\r\n/g, "\n");

  it("nothing invents created_at", () => {
    /* The previous helper synthesised a User with `created_at: ""`, which
       invited callers to read a field the token cannot vouch for -- and
       friends/page.tsx did exactly that. */
    /* Comments are stripped first: the docstring quotes `created_at: ""`
       precisely to explain why it was removed, and matching the whole file
       would fail on its own explanation. */
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    expect(code).not.toContain("created_at");
  });

  it("no claim-derived object is cast to a Supabase User", () => {
    expect(SOURCE).not.toMatch(/as Awaited<ReturnType<typeof supabase\.auth\.getUser>>/);
  });

  it("the ambiguous helpers are gone, so every call site states its choice", () => {
    expect(SOURCE).not.toMatch(/export const getCurrentUser\b/);
    expect(SOURCE).not.toMatch(/export const requireCurrentUser\b/);
    expect(SOURCE).toContain("export const getCurrentIdentity");
    expect(SOURCE).toContain("export const getCurrentUserRecord");
  });

  it("identity is a narrow type, not a User", () => {
    const type = SOURCE.slice(SOURCE.indexOf("export type CurrentIdentity"), SOURCE.indexOf("export const getCurrentIdentity"));
    for (const forbidden of ["aud", "created_at", "confirmed_at", "last_sign_in_at", "identities"]) {
      expect(type).not.toContain(`${forbidden}:`);
    }
  });
});

describe("privileged callers use the authoritative helper", () => {
  /* lib/safety/admin.ts is checked separately below: it legitimately contains
     BOTH -- getSafetyAdminContext (authoritative, grants access) and
     getAdminLinkVisibility (identity, decides whether a menu item renders). A
     file-level assertion cannot tell those apart. */
  const PRIVILEGED = [
    "app/api/account/support-refresh/route.ts",
    "app/(app)/safe-arrival/page.tsx",
    "app/(app)/settings/access/page.tsx",
    "app/(app)/contact-actions.ts",
    "app/(app)/hangout-actions.ts"
  ];

  it("Admin, Safe Arrival, Access and account paths never use identity", () => {
    for (const path of PRIVILEGED) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} must not resolve identity from claims alone`).not.toMatch(
        /getCurrentIdentity|requireCurrentIdentity/
      );
      expect(source, `${path} must use the authoritative record`).toMatch(
        /getCurrentUserRecord|requireCurrentUserRecord/
      );
    }
  });

  it("the function that GRANTS admin access is authoritative; only the link check is not", () => {
    const source = readFileSync("lib/safety/admin.ts", "utf8").replace(/\r\n/g, "\n");
    const bodyOf = (name: string) => {
      const start = source.indexOf(`export async function ${name}`);
      return start === -1 ? "" : source.slice(start, source.indexOf("\n}", start));
    };

    const granting = bodyOf("getSafetyAdminContext");
    expect(granting, "getSafetyAdminContext must see revocation").toContain("getCurrentUserRecord");
    expect(granting, "granting admin access must never rest on claims alone").not.toContain("getCurrentIdentity");

    /* And the identity-based one must remain presentation-only: it returns a
       boolean for a menu item and cannot hand back a context anything
       authorizes against. */
    expect(bodyOf("getAdminLinkVisibility")).toContain("Promise<boolean>");
  });
});
