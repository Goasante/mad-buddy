import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * The two new repair recipes, against real rows.
 *
 * The safety-critical claim is negative and cannot be proven by reading code:
 * closing stalled journeys must leave an `unconfirmed` one alone even when it
 * looks identical by timing. So the fixtures below deliberately create both and
 * check that only one moves.
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
const madeJourneys: string[] = [];

async function cleanup() {
  for (const id of madeSessions) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", id);
    await admin.from("hangout_sessions").delete().eq("id", id);
  }
  madeSessions.length = 0;
  for (const id of madeJourneys) {
    await admin.from("safe_arrival_events").delete().eq("session_id", id);
    await admin.from("safe_arrival_contacts").delete().eq("session_id", id);
    await admin.from("safe_arrival_sessions").delete().eq("id", id);
  }
  madeJourneys.length = 0;
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

/** A journey in the given status, already past its arrival and grace period. */
async function seedJourney(status: string) {
  const { data, error } = await admin
    .from("safe_arrival_sessions")
    .insert({
      traveller_id: OWNER,
      destination_type: "custom",
      destination_label: "Test destination",
      expected_arrival_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      grace_period_minutes: 15,
      status,
      started_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();
  if (error) throw new Error(`journey: ${error.message}`);
  madeJourneys.push(data.id);
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

/** The exact statements `closeStalledSafeArrival` issues. */
async function runCloseStalled() {
  const { data: sessions } = await admin
    .from("safe_arrival_sessions")
    .select("id, status, expected_arrival_at, grace_period_minutes")
    .eq("traveller_id", OWNER)
    .in("status", ["active", "grace_period", "extended"]);

  const now = Date.now();
  const stalled = (sessions ?? [])
    .filter(
      (r: { expected_arrival_at: string | null; grace_period_minutes: number | null }) =>
        Boolean(r.expected_arrival_at) &&
        Date.parse(r.expected_arrival_at!) + (r.grace_period_minutes ?? 0) * 60_000 <= now
    )
    .map((r: { id: string }) => r.id);

  if (stalled.length === 0) return { attempted: 0 };

  await admin
    .from("safe_arrival_sessions")
    .update({ status: "expired", expired_at: new Date().toISOString() })
    .in("id", stalled)
    .in("status", ["active", "grace_period", "extended"]);
  return { attempted: stalled.length };
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

describeLocal("closing journeys that finished but stayed live", () => {
  it(
    "expires an active journey past its grace period",
    async () => {
      const id = await seedJourney("active");

      const result = await runCloseStalled();

      expect(result.attempted).toBe(1);
      const { data } = await admin.from("safe_arrival_sessions").select("status").eq("id", id).single();
      expect(data.status).toBe("expired");
    },
    DB_TIMEOUT
  );

  it(
    "THE SAFETY BOUNDARY: an unconfirmed journey is left completely alone",
    async () => {
      /* Identical by timing to the stalled one above -- past arrival, past
         grace. The only difference is the status, and that is exactly what
         must protect it. */
      const unconfirmedId = await seedJourney("unconfirmed");
      const stalledId = await seedJourney("active");

      await runCloseStalled();

      const { data: unconfirmed } = await admin
        .from("safe_arrival_sessions")
        .select("status")
        .eq("id", unconfirmedId)
        .single();
      const { data: stalled } = await admin
        .from("safe_arrival_sessions")
        .select("status")
        .eq("id", stalledId)
        .single();

      expect(unconfirmed.status).toBe("unconfirmed");
      expect(stalled.status).toBe("expired");
    },
    DB_TIMEOUT
  );

  it(
    "leaves a journey still inside its grace period alone",
    async () => {
      const { data } = await admin
        .from("safe_arrival_sessions")
        .insert({
          traveller_id: OWNER,
          destination_type: "custom",
          destination_label: "Not yet due",
          expected_arrival_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          grace_period_minutes: 15,
          status: "active",
          started_at: new Date().toISOString()
        })
        .select("id")
        .single();
      madeJourneys.push(data.id);

      await runCloseStalled();

      const { data: after } = await admin
        .from("safe_arrival_sessions")
        .select("status")
        .eq("id", data.id)
        .single();
      expect(after.status).toBe("active");
    },
    DB_TIMEOUT
  );

  it(
    "reports nothing to do when no journey is stalled",
    async () => {
      expect((await runCloseStalled()).attempted).toBe(0);
    },
    DB_TIMEOUT
  );
});
