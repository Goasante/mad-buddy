import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * A NON-MUDDY ACCEPTED INTO AN UPFOR IS A LEGITIMATE PLAN PARTICIPANT.
 *
 * UpFor is not only for existing Muddies. A creator may opt a session into
 * discovery beyond their circle, and a stranger can legitimately discover it,
 * ask to join, and be ACCEPTED. The canonical Plan lifecycle then refused them:
 * converting raised PLAN_PARTICIPANT_INELIGIBLE, and even past that the
 * reconciler would have evicted them from the Plan Chat and RSVP would have
 * trapped them. The product offered a loop it could not complete.
 *
 * The rule these tests hold, and its exact limits:
 *
 *     accepted participant of THIS UpFor
 *         -> participant of THIS converted Plan
 *         -> member of THIS Plan Chat
 *
 * CONTEXTUAL, NOT FRIENDSHIP. So most of what follows is negative: no
 * friendship row appears, no direct conversation appears, an acceptance on one
 * session grants nothing on another, a live block still wins, and the manual
 * invite path still refuses strangers outright.
 *
 * Against the real local database, because every one of those is a database
 * truth and the whole defect lived in SQL.
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

/* HOST and STRANGER are deliberately NOT Muddies: `ensureNotMuddies` ends any
   friendship between them before every case. MUDDY is a normal friend, so the
   ordinary path can be checked alongside the contextual one. */
const HOST = USERS.A;
const STRANGER = USERS.D;
const MUDDY = USERS.B;
const OUTSIDER = USERS.C;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

async function ensureNotMuddies(a: string, b: string) {
  const [low, high] = pair(a, b);
  await admin
    .from("friendships")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null);
}

async function ensureMuddies(a: string, b: string) {
  const [low, high] = pair(a, b);
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null)
    .maybeSingle();
  if (!existing) {
    await admin.from("friendships").insert({ user_one_id: low, user_two_id: high });
  }
}

async function areMuddies(a: string, b: string) {
  const [low, high] = pair(a, b);
  const { data } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null);
  return (data ?? []).length > 0;
}

/** An UpFor owned by HOST, with the given answers on it. */
async function seedUpFor(answers: Array<{ user: string; status: string }>) {
  const { data: session } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: HOST,
      activity_type: "coffee",
      status: "active",
      /* Opted into discovery beyond the owner's own Muddies -- the product
         decision that makes a stranger's request legitimate in the first
         place. The permission this suite tests is the ACCEPTANCE, not this
         field, but the scenario is only realistic with it set. */
      discovery_scope: "nearby",
      audience_type: "all_muddies",
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      max_participants: 10
    })
    .select("id")
    .single();
  const hangoutId = String(session?.id);

  if (answers.length > 0) {
    await admin.from("hangout_requests").insert(
      answers.map((a) => ({
        hangout_session_id: hangoutId,
        requester_id: a.user,
        status: a.status,
        responded_at: a.status === "pending" ? null : new Date().toISOString()
      }))
    );
  }
  return hangoutId;
}

async function convert(hangoutId: string | null, actorId = HOST, inviteeIds: string[] = []) {
  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: actorId,
    p_request_key: crypto.randomUUID(),
    p_title: "Coffee",
    p_description: null,
    p_plan_type: "quick",
    p_start_at: null,
    p_end_at: null,
    p_timezone: "UTC",
    p_rsvp_deadline: null,
    p_place_type: "decide_in_chat",
    p_custom_place_text: null,
    p_reminder_minutes: null,
    p_category: null,
    /* Empty for conversions, exactly as lib/plans/service.ts passes them: the
       RPC derives participants from the database, never from these. */
    p_invitee_ids: inviteeIds,
    p_initial_going_ids: [],
    p_source_hangout_id: hangoutId,
    p_effective_max_active_plans: 50,
    p_effective_max_participants: 20
  });
  return { row: data?.[0], error };
}

async function participants(planId: string) {
  const { data } = await admin
    .from("plan_participants")
    .select("user_id, rsvp_status")
    .eq("plan_id", planId);
  return data ?? [];
}

async function chatMembers(conversationId: string) {
  const { data } = await admin
    .from("conversation_members")
    .select("user_id, status")
    .eq("conversation_id", conversationId)
    .eq("status", "joined");
  return (data ?? []).map((row: { user_id: string }) => row.user_id).sort();
}

/** Every Plan this suite created, and everything hanging off it. */
async function clearPlans() {
  const { data: plans } = await admin.from("plans").select("id").eq("creator_id", HOST);
  for (const plan of plans ?? []) {
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", plan.id);
    for (const conv of convs ?? []) {
      await admin.from("messages").delete().eq("conversation_id", conv.id);
      await admin.from("conversation_members").delete().eq("conversation_id", conv.id);
      await admin.from("conversations").delete().eq("id", conv.id);
    }
    await admin.from("plan_participants").delete().eq("plan_id", plan.id);
    await admin.from("plans").delete().eq("id", plan.id);
  }
}

async function clearUpFors() {
  const { data: sessions } = await admin.from("hangout_sessions").select("id").eq("owner_id", HOST);
  for (const session of sessions ?? []) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", session.id);
  }
  await admin.from("hangout_sessions").delete().eq("owner_id", HOST);
}

async function clearBlocks() {
  await admin.from("blocked_users").delete().in("blocker_id", [HOST, STRANGER, MUDDY, OUTSIDER]);
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

beforeEach(async () => {
  if (!isLocal) return;
  /* SELF-CLEANING. The lifecycle enforces a per-creator active-Plan limit, so
     accumulated fixtures eventually fail with PLAN_ACTIVE_LIMIT_REACHED -- a
     test-data problem that reads exactly like a product regression. */
  await clearPlans();
  await clearUpFors();
  await clearBlocks();
  await ensureNotMuddies(HOST, STRANGER);
  await ensureMuddies(HOST, MUDDY);
});

afterAll(async () => {
  if (!isLocal) return;
  await clearPlans();
  await clearUpFors();
  await clearBlocks();
  /* RESTORE THE SHARED FIXTURE.
     This suite deliberately ENDS the A/D friendship so the pair is genuinely
     not Muddies -- that is the whole point of it. But the seed contract other
     local suites rely on expects that friendship to exist, and leaving it ended
     made an unrelated IDOR baseline fail on the full run while passing in
     isolation. A suite that mutates shared fixture state has to put it back. */
  await ensureMuddies(HOST, STRANGER);
});

describeLocal("an accepted non-Muddy converts into the Plan", () => {
  it("the pair really are not Muddies, so the rest of the suite means something", async () => {
    expect(await areMuddies(HOST, STRANGER)).toBe(false);
  }, DB_TIMEOUT);

  it("converts, and carries the accepted stranger as going", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row, error } = await convert(hangoutId);

    expect(error).toBeNull();
    expect(row?.plan_id).toBeTruthy();

    const rows = await participants(String(row.plan_id));
    const stranger = rows.find((p: { user_id: string }) => p.user_id === STRANGER);
    expect(stranger?.rsvp_status).toBe("going");
  }, DB_TIMEOUT);

  it("creates the Plan Chat and joins the stranger to it", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);

    expect(row?.conversation_id).toBeTruthy();
    expect(await chatMembers(String(row.conversation_id))).toEqual(pair(HOST, STRANGER));
  }, DB_TIMEOUT);

  it("works as a TWO-person Plan Chat -- it is still a Plan Chat", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);
    expect(await chatMembers(String(row.conversation_id))).toHaveLength(2);

    const { data: conversation } = await admin
      .from("conversations")
      .select("conversation_type, context_type")
      .eq("id", row.conversation_id)
      .maybeSingle();
    /* Not promoted to a direct conversation just because there are two people
       in it. Two, three or ten -- same rule, same kind of room. */
    expect(conversation?.conversation_type).toBe("plan");
    expect(conversation?.context_type).toBe("plan");
  }, DB_TIMEOUT);

  it("works with THREE or more, mixing a stranger and a Muddy", async () => {
    const hangoutId = await seedUpFor([
      { user: STRANGER, status: "accepted" },
      { user: MUDDY, status: "accepted" }
    ]);
    const { row, error } = await convert(hangoutId);

    expect(error).toBeNull();
    expect(await chatMembers(String(row.conversation_id))).toEqual(
      [HOST, STRANGER, MUDDY].sort()
    );
  }, DB_TIMEOUT);

  it("lets the contextual participant actually send in the Plan Chat", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);

    const { error } = await admin.from("messages").insert({
      conversation_id: row.conversation_id,
      sender_id: STRANGER,
      text_content: "On my way",
      message_type: "text"
    });
    expect(error).toBeNull();
  }, DB_TIMEOUT);
});

describeLocal("only ACCEPTED answers carry over", () => {
  it("pending does not convert", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "pending" }]);
    const { row } = await convert(hangoutId);
    const rows = await participants(String(row.plan_id));
    expect(rows.some((p: { user_id: string }) => p.user_id === STRANGER)).toBe(false);
  }, DB_TIMEOUT);

  it("declined does not convert", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "declined" }]);
    const { row } = await convert(hangoutId);
    const rows = await participants(String(row.plan_id));
    expect(rows.some((p: { user_id: string }) => p.user_id === STRANGER)).toBe(false);
  }, DB_TIMEOUT);

  /**
   * THE ONE THAT MATTERS FOR SAFETY. The permission is the acceptance, and the
   * candidate list is derived server-side -- so a client naming a stranger it
   * likes cannot smuggle them in.
   */
  it("an arbitrary client-supplied stranger is ignored on a conversion", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row, error } = await convert(hangoutId, HOST, [OUTSIDER]);

    expect(error).toBeNull();
    const rows = await participants(String(row.plan_id));
    expect(rows.some((p: { user_id: string }) => p.user_id === OUTSIDER)).toBe(false);
  }, DB_TIMEOUT);

  it("an acceptance on a DIFFERENT UpFor grants nothing here", async () => {
    /* The stranger is accepted on session one; the Plan is converted from
       session two. Scoping is through plans.source_hangout_id, so the first
       acceptance must not reach the second Plan. */
    await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const otherHangout = await seedUpFor([{ user: MUDDY, status: "accepted" }]);
    const { row } = await convert(otherHangout);

    const rows = await participants(String(row.plan_id));
    expect(rows.some((p: { user_id: string }) => p.user_id === STRANGER)).toBe(false);
    expect(await chatMembers(String(row.conversation_id))).toEqual(pair(HOST, MUDDY));
  }, DB_TIMEOUT);
});

describeLocal("a live block always wins", () => {
  it("excludes a blocked stranger even with an accepted request", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    await admin.from("blocked_users").insert({ blocker_id: HOST, blocked_id: STRANGER });

    const { row, error } = await convert(hangoutId);
    /* The conversion itself is refused: the only candidate is ineligible. */
    expect(error?.message).toContain("PLAN_PARTICIPANT_INELIGIBLE");
    expect(row).toBeUndefined();
  }, DB_TIMEOUT);

  it("excludes when the STRANGER blocked the host, not just the reverse", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    await admin.from("blocked_users").insert({ blocker_id: STRANGER, blocked_id: HOST });

    const { error } = await convert(hangoutId);
    expect(error?.message).toContain("PLAN_PARTICIPANT_INELIGIBLE");
  }, DB_TIMEOUT);

  it("removes a contextual member from the chat if a block appears later", async () => {
    const hangoutId = await seedUpFor([
      { user: STRANGER, status: "accepted" },
      { user: MUDDY, status: "accepted" }
    ]);
    const { row } = await convert(hangoutId);
    expect(await chatMembers(String(row.conversation_id))).toContain(STRANGER);

    await admin.from("blocked_users").insert({ blocker_id: HOST, blocked_id: STRANGER });
    await admin.rpc("reconcile_plan_conversation_members", { p_plan_id: row.plan_id });

    expect(await chatMembers(String(row.conversation_id))).not.toContain(STRANGER);
  }, DB_TIMEOUT);
});

describeLocal("no relationship is created by any of this", () => {
  it("creates no friendship, no request, and no direct conversation", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    await convert(hangoutId);

    expect(await areMuddies(HOST, STRANGER)).toBe(false);

    const [low, high] = pair(HOST, STRANGER);
    const { data: requests } = await admin
      .from("friend_requests")
      .select("id")
      .or(`and(sender_id.eq.${HOST},receiver_id.eq.${STRANGER}),and(sender_id.eq.${STRANGER},receiver_id.eq.${HOST})`);
    expect(requests ?? []).toHaveLength(0);

    const { data: direct } = await admin
      .from("conversations")
      .select("id")
      .eq("conversation_type", "direct")
      .eq("direct_key", `${low}:${high}`);
    expect(direct ?? []).toHaveLength(0);

    const { data: linkr } = await admin
      .from("linkr_connections")
      .select("id")
      .eq("user_low", low)
      .eq("user_high", high)
      .is("ended_at", null);
    expect(linkr ?? []).toHaveLength(0);
  }, DB_TIMEOUT);
});

describeLocal("the manual invite path stays Muddies-only", () => {
  /**
   * `add_plan_participants` takes ids straight from the client. If this
   * relaxed, the ordinary participant picker would become a stranger picker --
   * exactly what the UpFor exception must not cause.
   */
  it("refuses a stranger added by hand to an ordinary Plan", async () => {
    const hangoutId = await seedUpFor([{ user: MUDDY, status: "accepted" }]);
    const { row } = await convert(hangoutId);

    const { error } = await admin.rpc("add_plan_participants", {
      p_actor_id: HOST,
      p_plan_id: row.plan_id,
      p_participant_ids: [STRANGER],
      p_effective_max_participants: 20
    });
    expect(error?.message).toContain("PLAN_PARTICIPANT_INELIGIBLE");
  }, DB_TIMEOUT);

  it("still accepts a real Muddy added by hand", async () => {
    const hangoutId = await seedUpFor([]);
    const { row } = await convert(hangoutId);

    const { error } = await admin.rpc("add_plan_participants", {
      p_actor_id: HOST,
      p_plan_id: row.plan_id,
      p_participant_ids: [MUDDY],
      p_effective_max_participants: 20
    });
    expect(error).toBeNull();
  }, DB_TIMEOUT);
});

describeLocal("the contextual participant is not trapped afterwards", () => {
  it("can answer their own RSVP", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);

    const { error } = await admin.rpc("set_plan_participant_rsvp", {
      p_actor_id: STRANGER,
      p_plan_id: row.plan_id,
      p_status: "maybe"
    });
    expect(error).toBeNull();

    const rows = await participants(String(row.plan_id));
    const stranger = rows.find((p: { user_id: string }) => p.user_id === STRANGER);
    expect(stranger?.rsvp_status).toBe("maybe");
  }, DB_TIMEOUT);

  it("leaves the chat when they answer not_going, and can come back", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);

    await admin.rpc("set_plan_participant_rsvp", {
      p_actor_id: STRANGER,
      p_plan_id: row.plan_id,
      p_status: "not_going"
    });
    expect(await chatMembers(String(row.conversation_id))).not.toContain(STRANGER);

    await admin.rpc("set_plan_participant_rsvp", {
      p_actor_id: STRANGER,
      p_plan_id: row.plan_id,
      p_status: "going"
    });
    expect(await chatMembers(String(row.conversation_id))).toContain(STRANGER);
  }, DB_TIMEOUT);

  it("is refused once a block exists, even mid-plan", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const { row } = await convert(hangoutId);
    await admin.from("blocked_users").insert({ blocker_id: HOST, blocked_id: STRANGER });

    const { error } = await admin.rpc("set_plan_participant_rsvp", {
      p_actor_id: STRANGER,
      p_plan_id: row.plan_id,
      p_status: "going"
    });
    expect(error?.message).toContain("PLAN_PARTICIPANT_INELIGIBLE");
  }, DB_TIMEOUT);
});

describeLocal("conversion stays idempotent", () => {
  it("a retried conversion produces one Plan and one Plan Chat", async () => {
    const hangoutId = await seedUpFor([{ user: STRANGER, status: "accepted" }]);
    const key = crypto.randomUUID();

    const call = async () =>
      admin.rpc("create_plan_lifecycle", {
        p_actor_id: HOST,
        p_request_key: key,
        p_title: "Coffee",
        p_description: null,
        p_plan_type: "quick",
        p_start_at: null,
        p_end_at: null,
        p_timezone: "UTC",
        p_rsvp_deadline: null,
        p_place_type: "decide_in_chat",
        p_custom_place_text: null,
        p_reminder_minutes: null,
        p_category: null,
        p_invitee_ids: [],
        p_initial_going_ids: [],
        p_source_hangout_id: hangoutId,
        p_effective_max_active_plans: 50,
        p_effective_max_participants: 20
      });

    const first = await call();
    const second = await call();

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data?.[0]?.plan_id).toBe(first.data?.[0]?.plan_id);
    expect(second.data?.[0]?.created).toBe(false);

    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", first.data[0].plan_id);
    expect(convs ?? []).toHaveLength(1);
  }, DB_TIMEOUT);
});
