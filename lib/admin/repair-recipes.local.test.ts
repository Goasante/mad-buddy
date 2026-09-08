import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * The UpFor repair recipe, against real rows.
 *
 * The claims worth proving are negative: a live session's requests must not be
 * touched, and a settled request must be DECLINED rather than accepted, so the
 * repair can never add somebody to something.
 *
 * A Safe Arrival repair was here and has been removed -- see
 * lib/admin/event-safety-diagnostics.ts. Writing `expired` directly skipped the
 * canonical transition to `unconfirmed`, which is what alerts the watchers.
 *
 * These exercise the same statements the server actions issue. Importing the
 * actions directly would require an admin session; what matters here is that
 * the SQL does what the action claims.
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
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const DB_TIMEOUT = 30_000;

const OWNER = USERS.B;
const ASKER = USERS.C;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const madeSessions: string[] = [];

async function cleanup() {
  for (const id of madeSessions) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", id);
    await admin.from("hangout_sessions").delete().eq("id", id);
  }
  madeSessions.length = 0;
}

/** An UpFor owned by OWNER in the given status, with a pending request on it. */
async function seedSession(status: string, withPendingRequest = true) {
  const { data, error } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: OWNER,
      activity_type: "coffee",
      status,
      discovery_scope: "nearby",
      audience_type: "all_muddies",
      starts_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      max_participants: 10
    })
    .select("id")
    .single();
  if (error) throw new Error(`session: ${error.message}`);
  madeSessions.push(data.id);
  if (withPendingRequest) {
    const { error: reqError } = await admin
      .from("hangout_requests")
      .insert({ hangout_session_id: data.id, requester_id: ASKER, status: "pending" });
    if (reqError) throw new Error(`request: ${reqError.message}`);
  }
  return data.id as string;
}

/** The exact statements `settleStrandedUpForRequests` issues. */
async function runSettleStranded() {
  const { data: closed } = await admin
    .from("hangout_sessions")
    .select("id")
    .eq("owner_id", OWNER)
    .in("status", ["expired", "cancelled", "converted_to_plan"]);
  const ids = (closed ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return { attempted: 0, remaining: 0 };

  const { data: settled } = await admin
    .from("hangout_requests")
    .update({ status: "declined" })
    .eq("status", "pending")
    .in("hangout_session_id", ids)
    .select("id");
  const { data: remaining } = await admin
    .from("hangout_requests")
    .select("id")
    .eq("status", "pending")
    .in("hangout_session_id", ids);
  return { attempted: (settled ?? []).length, remaining: (remaining ?? []).length };
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

beforeEach(async () => {
  if (!isLocal) return;
  await cleanup();
});

afterAll(async () => {
  if (!isLocal) return;
  await cleanup();
});

describeLocal("settling requests stranded on a closed UpFor", () => {
  it(
    "declines requests on an expired session, and reports the count",
    async () => {
      await seedSession("expired");

      const result = await runSettleStranded();

      expect(result.attempted).toBe(1);
      expect(result.remaining).toBe(0);
    },
    DB_TIMEOUT
  );

  it(
    "does the same for cancelled and converted sessions",
    async () => {
      await seedSession("cancelled");
      await seedSession("converted_to_plan");

      expect((await runSettleStranded()).attempted).toBe(2);
    },
    DB_TIMEOUT
  );

  it(
    "NEVER touches a request on a live session",
    async () => {
      const liveId = await seedSession("active");

      await runSettleStranded();

      const { data } = await admin
        .from("hangout_requests")
        .select("status")
        .eq("hangout_session_id", liveId)
        .single();
      expect(data.status).toBe("pending");
    },
    DB_TIMEOUT
  );

  it(
    "adds nobody to anything -- the request is declined, not accepted",
    async () => {
      const sessionId = await seedSession("expired");

      await runSettleStranded();

      const { data } = await admin
        .from("hangout_requests")
        .select("status")
        .eq("hangout_session_id", sessionId)
        .single();
      expect(data.status).toBe("declined");
      expect(data.status).not.toBe("accepted");
    },
    DB_TIMEOUT
  );

  it(
    "reports nothing to do when no request is stranded",
    async () => {
      await seedSession("expired", false);

      expect((await runSettleStranded()).attempted).toBe(0);
    },
    DB_TIMEOUT
  );
});

describeLocal("narrowed repairs never exceed the invariant they name", () => {
  async function clearStatuses() {
    await admin.from("user_statuses").delete().eq("user_id", OWNER);
  }

  async function seedStatus(expiresAt: string) {
    const { error } = await admin.from("user_statuses").insert({
      user_id: OWNER,
      availability_type: "free",
      visibility_type: "all_muddies",
      starts_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      expires_at: expiresAt
    });
    if (error) throw new Error(`status: ${error.message}`);
  }

  /** The exact predicate `clearStuckStatus` applies. */
  async function runClearStuck() {
    const nowIso = new Date().toISOString();
    const { data: before } = await admin.from("user_statuses").select("id, expires_at").eq("user_id", OWNER);
    const stuckIds = (before ?? [])
      .filter((r: { expires_at: string | null }) => Boolean(r.expires_at) && r.expires_at! <= nowIso)
      .map((r: { id: string }) => r.id);
    if (stuckIds.length > 0) {
      await admin.from("user_statuses").delete().in("id", stuckIds).lte("expires_at", nowIso);
    }
    const { data: after } = await admin.from("user_statuses").select("id").eq("user_id", OWNER);
    return { removed: stuckIds.length, remaining: (after ?? []).length };
  }

  it(
    "removes a status whose expiry has passed",
    async () => {
      await clearStatuses();
      await seedStatus(new Date(Date.now() - 60 * 60 * 1000).toISOString());

      const result = await runClearStuck();

      expect(result.removed).toBe(1);
      expect(result.remaining).toBe(0);
      await clearStatuses();
    },
    DB_TIMEOUT
  );

  it(
    "NEVER removes a status that is still current",
    async () => {
      /* The bug this pins: the executor used to delete every status row, so an
         operator clicking a repair labelled "stuck" could erase a status the
         person had deliberately set moments earlier. `user_statuses` holds one
         row per user, so that was the ONLY row -- the whole status, gone. */
      await clearStatuses();
      await seedStatus(new Date(Date.now() + 60 * 60 * 1000).toISOString());

      const result = await runClearStuck();

      expect(result.removed).toBe(0);
      expect(result.remaining).toBe(1);
      await clearStatuses();
    },
    DB_TIMEOUT
  );

  it(
    "clear_rate_limits clears an ACTIVE window and leaves an expired counter alone",
    async () => {
      await admin.from("rate_limits").delete().eq("user_id", OWNER);
      await admin.from("rate_limits").insert([
        {
          user_id: OWNER,
          action: "test.active",
          count: 9,
          window_start: new Date(Date.now() - 60_000).toISOString(),
          window_end: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        },
        {
          user_id: OWNER,
          action: "test.expired",
          count: 9,
          window_start: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          window_end: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        }
      ]);

      const nowIso = new Date().toISOString();
      const { data: active } = await admin
        .from("rate_limits")
        .select("id")
        .eq("user_id", OWNER)
        .gt("window_end", nowIso);
      await admin
        .from("rate_limits")
        .delete()
        .in("id", (active ?? []).map((r: { id: string }) => r.id));

      const { data: after } = await admin.from("rate_limits").select("action").eq("user_id", OWNER);
      expect((after ?? []).map((r: { action: string }) => r.action)).toEqual(["test.expired"]);

      await admin.from("rate_limits").delete().eq("user_id", OWNER);
    },
    DB_TIMEOUT
  );
});
