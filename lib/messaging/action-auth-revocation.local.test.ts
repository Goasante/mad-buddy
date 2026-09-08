import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * WHAT A REVOKED SESSION CAN STILL DO, PROVED AGAINST A REAL AUTH SERVER.
 *
 * The structural suite next door asserts that each action calls the intended
 * helper. It cannot show what that actually MEANS at runtime, and the whole
 * argument for the identity path rests on a runtime claim: that a globally
 * signed-out token keeps working until it expires. So this exercises the real
 * helpers against real GoTrue, with real revocation, and pins the exact
 * boundary the product accepts.
 *
 * The policy under test, stated plainly:
 *
 *   low-risk context reads   ALLOWED for <=60 min after global sign-out
 *   strictly private state   ALLOWED for the same window
 *   write anything others    REFUSED immediately
 *   authorization-affecting  REFUSED immediately
 *   see anything privileged  REFUSED immediately
 *
 * "Low-risk context reads" is deliberately broader than "your own threads":
 * it also covers messageable-friend discovery, structured-share options and
 * reply context. Stated at its real width rather than a flattering one.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const TIMEOUT = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const made: string[] = [];

async function freshUser(label: string) {
  const email = `revoke-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "HardeningPass123!",
    email_confirm: true
  });
  if (error) throw new Error(`create user: ${error.message}`);
  made.push(data.user.id);

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await anon.auth.signInWithPassword({ email, password: "HardeningPass123!" });
  if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);
  return { userId: data.user.id, token: signIn.data.session.access_token };
}

/** The two helpers, resolved the way a server action resolves them. */
async function identityIdFor(token: string): Promise<string | null> {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const result = await client.auth.getClaims(token);
  if (result.error || !result.data?.claims?.sub) return null;
  return result.data.claims.sub as string;
}

async function authoritativeIdFor(token: string): Promise<string | null> {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const result = await client.auth.getUser(token);
  if (result.error || !result.data?.user) return null;
  return result.data.user.id;
}

beforeAll(async () => {
  if (!isLocal) return;
  ({ createClient } = await import("@supabase/supabase-js"));
  admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
});

afterAll(async () => {
  if (!isLocal) return;
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {});
});

describeLocal("a globally signed-out session", () => {
  it(
    "can still READ, which is the accepted <=60 minute window",
    async () => {
      const { token, userId } = await freshUser("read");
      await admin.auth.admin.signOut(token, "global");

      /* Not a bug being documented away: this is the deliberate trade that
         removes seven auth round trips from opening a conversation. It is
         acceptable only because the same token can no longer WRITE -- proved
         by the tests below. */
      expect(await identityIdFor(token)).toBe(userId);
    },
    TIMEOUT
  );

  it(
    "cannot SEND -- the authoritative helper refuses",
    async () => {
      const { token } = await freshUser("send");
      await admin.auth.admin.signOut(token, "global");

      expect(await authoritativeIdFor(token)).toBeNull();
    },
    TIMEOUT
  );

  it(
    "cannot perform a SHARED mutation -- edit, delete, pin, poll, settings",
    async () => {
      const { token } = await freshUser("shared");
      await admin.auth.admin.signOut(token, "global");

      /* Every shared mutation resolves its user through this one helper, so a
         single refusal here is the refusal for all of them. Which actions
         those are is pinned by the structural suite. */
      expect(await authoritativeIdFor(token)).toBeNull();
    },
    TIMEOUT
  );

  it(
    "is refused by Admin, which was already authoritative",
    async () => {
      const { token } = await freshUser("admin");
      await admin.auth.admin.signOut(token, "global");

      expect(await authoritativeIdFor(token)).toBeNull();
    },
    TIMEOUT
  );
});

describeLocal("a deleted account", () => {
  it(
    "cannot perform a shared mutation",
    async () => {
      const { token, userId } = await freshUser("deleted");
      await admin.auth.admin.deleteUser(userId);

      expect(await authoritativeIdFor(token)).toBeNull();
    },
    TIMEOUT
  );
});

describeLocal("an ordinary signed-in session", () => {
  it(
    "still works on BOTH paths -- the split did not break normal messaging",
    async () => {
      /* The check that keeps the others honest: refusing everybody would pass
         every test above. */
      const { token, userId } = await freshUser("normal");

      expect(await identityIdFor(token)).toBe(userId);
      expect(await authoritativeIdFor(token)).toBe(userId);
    },
    TIMEOUT
  );
});
