import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { explainPlanChatAccess } from "@/lib/admin/plan-upfor-diagnostics";
import { USERS } from "@/lib/test/acting-user";

/**
 * The Plan Chat explanation, checked against the deployed eligibility rule.
 *
 * `explainPlanChatAccess` encodes who the Plan lifecycle considers eligible.
 * If it ever drifts from `is_plan_participant_eligible`, Admin starts telling
 * people the opposite of what the product will do -- either sending a valid
 * participant off to add a friendship they do not need, or telling a stranger
 * they should be able to join. So the claim is checked against the function,
 * not against my reading of it.
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
const STRANGER = USERS.D;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
const created: { sessions: string[]; plans: string[]; conversations: string[] } = {
  sessions: [],
  plans: [],
  conversations: []
};

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

async function endFriendship(a: string, b: string) {
  const [low, high] = pair(a, b);
  await admin
    .from("friendships")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null);
}

async function restoreFriendship(a: string, b: string) {
  const [low, high] = pair(a, b);
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .maybeSingle();
  if (existing) {
    await admin.from("friendships").update({ ended_at: null }).eq("id", existing.id);
    return;
  }
  await admin.from("friendships").insert({ user_one_id: low, user_two_id: high });
}

/** An UpFor owned by HOST with an accepted request from `requester`. */
async function seedConvertedPlan(requester: string) {
  const { data: session } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: HOST,
      activity_type: "coffee",
      status: "active",
      discovery_scope: "nearby",
      audience_type: "all_muddies",
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      max_participants: 10
    })
    .select("id")
    .single();
  created.sessions.push(session.id);

  await admin
    .from("hangout_requests")
    .insert({ hangout_session_id: session.id, requester_id: requester, status: "accepted" });

  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: HOST,
    p_request_key: crypto.randomUUID(),
    p_title: "Converted",
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
    p_source_hangout_id: session.id,
    p_effective_max_active_plans: 50,
    p_effective_max_participants: 20
  });
  if (error) throw new Error(`create_plan_lifecycle: ${error.message}`);
  const planId = data?.[0]?.plan_id as string;
  created.plans.push(planId);
  if (data?.[0]?.conversation_id) created.conversations.push(data[0].conversation_id);
  return { sessionId: session.id, planId };
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

afterAll(async () => {
  if (!isLocal) return;
  for (const id of created.conversations) {
    await admin.from("messages").delete().eq("conversation_id", id);
    await admin.from("conversation_members").delete().eq("conversation_id", id);
    await admin.from("conversations").delete().eq("id", id);
  }
  for (const id of created.plans) {
    await admin.from("plan_participants").delete().eq("plan_id", id);
    await admin.from("plans").delete().eq("id", id);
  }
  for (const id of created.sessions) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", id);
    await admin.from("hangout_sessions").delete().eq("id", id);
  }
  // Restore the shared A/D fixture friendship.
  await restoreFriendship(HOST, STRANGER);
});

describeLocal("the explanation matches the deployed eligibility rule", () => {
  it(
    "a non-Muddy accepted onto the source UpFor is eligible in BOTH the database and the explanation",
    async () => {
      await endFriendship(HOST, STRANGER);
      const { sessionId, planId } = await seedConvertedPlan(STRANGER);

      // What the database says.
      const { data: dbEligible, error } = await admin.rpc("is_plan_participant_eligible", {
        p_plan_id: planId,
        p_host_id: HOST,
        p_candidate_id: STRANGER
      });
      expect(error).toBeNull();
      expect(dbEligible).toBe(true);

      // What Admin would tell the operator.
      const result = explainPlanChatAccess({
        planId,
        planStatus: "inviting",
        rsvpStatus: "going",
        conversationExists: true,
        joinedConversation: false,
        sourceHangoutId: sessionId,
        acceptedOnSourceHangout: true,
        muddyWithCreator: false,
        blockedWithCreator: false
      });

      // Eligible, so a missing membership is a FAULT -- not "you need a friendship".
      expect(result.outcome).toBe("still_broken");
    },
    DB_TIMEOUT
  );

  it(
    "a stranger with no accepted request is ineligible in BOTH",
    async () => {
      await endFriendship(HOST, STRANGER);
      const { planId } = await seedConvertedPlan(STRANGER);

      const OUTSIDER = USERS.C;
      const { data: dbEligible } = await admin.rpc("is_plan_participant_eligible", {
        p_plan_id: planId,
        p_host_id: HOST,
        p_candidate_id: OUTSIDER
      });
      expect(dbEligible).toBe(false);

      const result = explainPlanChatAccess({
        planId,
        planStatus: "inviting",
        rsvpStatus: "invited",
        conversationExists: true,
        joinedConversation: false,
        sourceHangoutId: null,
        acceptedOnSourceHangout: false,
        muddyWithCreator: false,
        blockedWithCreator: false
      });

      expect(result.outcome).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );

  it(
    "a live block makes the database refuse, and Admin says block first",
    async () => {
      await endFriendship(HOST, STRANGER);
      const { sessionId, planId } = await seedConvertedPlan(STRANGER);
      await admin.from("blocked_users").insert({ blocker_id: HOST, blocked_id: STRANGER });

      const { data: dbEligible } = await admin.rpc("is_plan_participant_eligible", {
        p_plan_id: planId,
        p_host_id: HOST,
        p_candidate_id: STRANGER
      });
      expect(dbEligible).toBe(false);

      const result = explainPlanChatAccess({
        planId,
        planStatus: "inviting",
        rsvpStatus: "going",
        conversationExists: true,
        joinedConversation: false,
        sourceHangoutId: sessionId,
        acceptedOnSourceHangout: true,
        muddyWithCreator: false,
        blockedWithCreator: true
      });

      expect(result.outcome).toBe("blocked_by_product_rule");
      expect(result.rule).toMatch(/block outranks/i);

      await admin.from("blocked_users").delete().eq("blocker_id", HOST).eq("blocked_id", STRANGER);
    },
    DB_TIMEOUT
  );
});
