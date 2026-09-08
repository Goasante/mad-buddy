import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { projectEventViews } from "@/lib/admin/event-doctor-projection";
import { explainEventAccess, type EventParticipationView } from "@/lib/admin/event-safety-diagnostics";
import { USERS } from "@/lib/test/acting-user";

/**
 * The Event authority, against real rows.
 *
 * The pure module already encodes the precedence; what this proves is that the
 * facts the LIVE Doctor reads from the database produce the same answers. The
 * previous implementation compared a `going` RSVP with circle membership and
 * ignored Event status and invitations entirely, so a cancelled Event or one
 * the account was never invited to looked like repairable drift.
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

const HOST = USERS.A;
const VIEWER = USERS.B;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const madeEvents: string[] = [];

async function cleanup() {
  for (const id of madeEvents) {
    const { data: circles } = await admin.from("event_circles").select("id").eq("event_id", id);
    for (const circle of circles ?? []) {
      await admin.from("event_circle_invitations").delete().eq("event_circle_id", circle.id);
      await admin.from("event_circle_members").delete().eq("event_circle_id", circle.id);
      await admin.from("event_circles").delete().eq("id", circle.id);
    }
    await admin.from("event_rsvps").delete().eq("event_id", id);
    await admin.from("events").delete().eq("id", id);
  }
  madeEvents.length = 0;
}

async function seedEvent(options: {
  status: string;
  visibility: string;
  rsvp?: "going" | "interested" | "not_going";
  withCircle?: boolean;
  joined?: boolean;
  invited?: boolean;
}) {
  const { data: event, error } = await admin
    .from("events")
    .insert({
      host_id: HOST,
      name: "Closeout fixture",
      status: options.status,
      visibility: options.visibility,
      starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();
  if (error) throw new Error(`event: ${error.message}`);
  madeEvents.push(event.id);

  let circleId: string | null = null;
  if (options.withCircle !== false) {
    const { data: circle, error: circleError } = await admin
      .from("event_circles")
      .insert({
        event_id: event.id,
        owner_id: HOST,
        name: "Attendees",
        join_mode: "check_in",
        status: "active",
        member_visibility: "members",
        max_members: 100
      })
      .select("id")
      .single();
    if (circleError) throw new Error(`circle: ${circleError.message}`);
    circleId = circle.id;

    if (options.joined) {
      await admin
        .from("event_circle_members")
        .insert({ event_circle_id: circleId, user_id: VIEWER, role: "member", status: "joined" });
    }
    if (options.invited) {
      await admin
        .from("event_circle_invitations")
        .insert({ event_circle_id: circleId, invited_user_id: VIEWER, invited_by: HOST, status: "pending" });
    }
  }

  if (options.rsvp) {
    await admin.from("event_rsvps").insert({ event_id: event.id, user_id: VIEWER, status: options.rsvp });
  }

  return { eventId: event.id, circleId };
}

/**
 * Reads the same rows the live loader reads, then hands them to the SAME
 * projection it uses. Building the view by hand here would prove the copy, not
 * the code that ships -- which is exactly how a loader filtering RSVPs to
 * `going` went unnoticed while this file kept passing.
 */
async function readEventView(eventId: string): Promise<EventParticipationView> {
  const { data: events } = await admin.from("events").select("id, status, visibility").eq("id", eventId);
  const { data: circles } = await admin.from("event_circles").select("id, event_id").eq("event_id", eventId);
  // Every RSVP state, exactly as the loader now selects them.
  const { data: rsvps } = await admin.from("event_rsvps").select("event_id, status").eq("user_id", VIEWER);

  const circleIds = (circles ?? []).map((row: { id: string }) => row.id);
  const { data: members } = circleIds.length
    ? await admin
        .from("event_circle_members")
        .select("event_circle_id")
        .eq("user_id", VIEWER)
        .eq("status", "joined")
        .in("event_circle_id", circleIds)
    : { data: [] };
  const { data: invitations } = circleIds.length
    ? await admin
        .from("event_circle_invitations")
        .select("event_circle_id")
        .eq("invited_user_id", VIEWER)
        .in("event_circle_id", circleIds)
    : { data: [] };

  const views = projectEventViews({
    events: events ?? [],
    circles: circles ?? [],
    rsvps: (rsvps ?? []).filter((row: { event_id: string }) => row.event_id === eventId),
    joinedCircleIds: new Set((members ?? []).map((row: { event_circle_id: string }) => row.event_circle_id)),
    invitedCircleIds: new Set((invitations ?? []).map((row: { event_circle_id: string }) => row.event_circle_id))
  });
  return views[0];
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

describeLocal("Event drift versus a correct refusal, from real rows", () => {
  it(
    "1. a live Event, going, eligible, missing circle membership IS drift",
    async () => {
      const { eventId } = await seedEvent({ status: "active", visibility: "public", rsvp: "going" });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("still_broken");
    },
    DB_TIMEOUT
  );

  it(
    "2. merely interested is NOT membership drift",
    async () => {
      const { eventId } = await seedEvent({ status: "active", visibility: "public", rsvp: "interested" });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );

  it(
    "3. an RSVP of no is a product rule, never a repair",
    async () => {
      const { eventId } = await seedEvent({ status: "active", visibility: "public", rsvp: "not_going" });

      const result = explainEventAccess(await readEventView(eventId));
      expect(result.outcome).toBe("blocked_by_product_rule");
      expect(result.summary).toMatch(/theirs to do/i);
    },
    DB_TIMEOUT
  );

  it(
    "4. a cancelled Event keeps its circle closed",
    async () => {
      const { eventId } = await seedEvent({ status: "cancelled", visibility: "public", rsvp: "going" });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );

  it(
    "5. a finished Event does too",
    async () => {
      const { eventId } = await seedEvent({ status: "ended", visibility: "public", rsvp: "going" });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );

  it(
    "6. invite-only with no invitation is the host's decision, not drift",
    async () => {
      const { eventId } = await seedEvent({ status: "active", visibility: "invite", rsvp: "going" });

      const result = explainEventAccess(await readEventView(eventId));
      expect(result.outcome).toBe("blocked_by_product_rule");
      expect(result.summary).toMatch(/only the host can invite/i);
    },
    DB_TIMEOUT
  );

  it(
    "7. an invited, going account that IS joined reads as healthy",
    async () => {
      const { eventId } = await seedEvent({
        status: "active",
        visibility: "invite",
        rsvp: "going",
        invited: true,
        joined: true
      });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("fixed");
    },
    DB_TIMEOUT
  );

  it(
    "8. membership still absent after a write attempt stays still_broken",
    async () => {
      /* The verifier must re-read rather than trust a mutation: an insert that
         silently affected nothing must not report fixed. */
      const { eventId, circleId } = await seedEvent({ status: "active", visibility: "public", rsvp: "going" });

      // A membership row in a non-joined state is NOT membership.
      await admin
        .from("event_circle_members")
        .insert({ event_circle_id: circleId, user_id: VIEWER, role: "member", status: "left" });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("still_broken");
    },
    DB_TIMEOUT
  );

  it(
    "an Event with no circle yet is nothing to repair",
    async () => {
      const { eventId } = await seedEvent({
        status: "active",
        visibility: "public",
        rsvp: "going",
        withCircle: false
      });

      expect(explainEventAccess(await readEventView(eventId)).outcome).toBe("not_applicable");
    },
    DB_TIMEOUT
  );
});
