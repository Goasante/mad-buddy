import { vi } from "vitest";

/**
 * Act as a specific signed-in user, or as nobody.
 *
 * MOCKS EXACTLY ONE THING: the session cookie boundary. Server actions read
 * their identity through createSupabaseServerClient().auth.getUser(), which in
 * a real request is decoded from a cookie -- there is no cookie in a test
 * process, so that single transport edge is stubbed.
 *
 * EVERYTHING ELSE RUNS FOR REAL against the local migrated Postgres: the admin
 * client, membership lookups, RLS-backed tables, ownership checks, retention
 * state and media authorization. Stubbing any of those would mock away the
 * authorization we are trying to prove.
 *
 * `actAs(null)` is the unauthenticated caller.
 */
export function installActingUser() {
  const state: { userId: string | null } = { userId: null };

  vi.mock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({
      auth: {
        getUser: async () => {
          const current = (globalThis as Record<string, unknown>).__ACTING_USER__ as
            | string
            | null
            | undefined;
          if (!current) return { data: { user: null }, error: null };
          return { data: { user: { id: current, email: `${current}@v4test.local` } }, error: null };
        }
      }
    })
  }));

  return state;
}

/** Set the acting identity for subsequent action calls. */
export function actAs(userId: string | null) {
  (globalThis as Record<string, unknown>).__ACTING_USER__ = userId;
}

export const USERS = {
  /** Member and sender in every fixture conversation. */
  A: "4a000000-0000-4000-8000-00000000004a",
  /** Second member: proves per-user private state stays private. */
  B: "4b000000-0000-4000-8000-00000000004b",
  /** Authenticated but unrelated: the IDOR attacker. */
  C: "4c000000-0000-4000-8000-00000000004c",
  /** Removed from the group: proves access ends with membership. */
  D: "4d000000-0000-4000-8000-00000000004d"
} as const;

export const CONVERSATIONS = {
  direct: "4d1a0000-0000-4000-8000-0000000d1a00",
  group: "4c700000-0000-4000-8000-00000000c700"
} as const;

export const EVENT_ID = "4e000000-0000-4000-8000-00000000004e";

/** A well-formed uuid that names nothing, for forged-id probes. */
export const ABSENT_UUID = "00000000-0000-4000-8000-0000000000ff";
