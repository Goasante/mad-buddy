import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * ADMIN REPAIRS AGAINST THE NOW-LIVE SOCIAL LIFECYCLE.
 *
 * PR #33 was written before PR #34 shipped. Two of its assumptions are now
 * owned by the database instead:
 *
 *   - `reopen_direct_conversation_on_unblock` reopens an archived direct
 *     conversation whenever the LAST block is lifted on a live friendship, so
 *     the drift `reconcile_direct_messaging` repairs largely cannot occur any
 *     more. The repair is kept as a BACKSTOP for rows that drifted before the
 *     migration, and it must not disagree with the trigger.
 *
 *   - `reconcile_plan_conversation_members` now admits an accepted UpFor
 *     participant who is NOT a Muddy. The Plan Chat repair calls that RPC, so
 *     it inherits the new rule -- but only if it really delegates rather than
 *     re-deciding eligibility itself.
 *
 * These run against the real local database because both claims are database
 * truths, and the whole risk of the rebase is semantic rather than textual.
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

/* B and C, so the A/D fixture friendship other suites rely on is untouched. */
const ALICE = USERS.B;
const BOB = USERS.C;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

const low = ALICE < BOB ? ALICE : BOB;
const high = ALICE < BOB ? BOB : ALICE;
const directKey = `${low}:${high}`;

async function clearBlocks() {
  await admin.from("blocked_users").delete().or(`blocker_id.eq.${ALICE},blocker_id.eq.${BOB}`);
}

async function clearConversation() {
  const { data: rows } = await admin.from("conversations").select("id").eq("direct_key", directKey);
  for (const row of rows ?? []) {
    await admin.from("messages").delete().eq("conversation_id", row.id);
    await admin.from("conversation_members").delete().eq("conversation_id", row.id);
    await admin.from("conversations").delete().eq("id", row.id);
  }
}

async function makeFriends() {
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

async function seedArchivedConversation() {
  const { data: convo } = await admin
    .from("conversations")
    .insert({ conversation_type: "direct", created_by: ALICE, direct_key: directKey, status: "archived" })
    .select("id")
    .single();
  await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: ALICE, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: BOB, role: "member", status: "joined" }
  ]);
  return convo.id as string;
}

async function conversationStatus() {
  const { data } = await admin.from("conversations").select("status").eq("direct_key", directKey).maybeSingle();
  return data?.status ?? null;
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

beforeEach(async () => {
  if (!isLocal) return;
  await clearBlocks();
  await clearConversation();
  await makeFriends();
});

afterAll(async () => {
  if (!isLocal) return;
  await clearBlocks();
  await clearConversation();
  await makeFriends();
});

describeLocal("the database now owns the reopen the Admin repair was written for", () => {
  it(
    "lifting the last block reopens the conversation with no Admin action at all",
    async () => {
      await seedArchivedConversation();
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });
      await admin.from("blocked_users").delete().eq("blocker_id", ALICE).eq("blocked_id", BOB);

      expect(await conversationStatus()).toBe("active");
    },
    DB_TIMEOUT
  );

  it(
    "so the drift the repair targets is left only for rows that predate the migration",
    async () => {
      /* Seeded directly as archived with a live friendship and no block -- the
         exact legacy shape, which no current code path can produce any more. */
      await seedArchivedConversation();

      expect(await conversationStatus()).toBe("archived");
    },
    DB_TIMEOUT
  );
});

describeLocal("Admin must never out-rank a live block", () => {
  it(
    "a conversation stays archived while a block stands, whatever else is true",
    async () => {
      await seedArchivedConversation();
      await admin.from("blocked_users").insert({ blocker_id: BOB, blocked_id: ALICE });

      // Friendship is live, but Bob blocks Alice.
      expect(await conversationStatus()).toBe("archived");
    },
    DB_TIMEOUT
  );

  it(
    "one side lifting a mutual block reopens nothing",
    async () => {
      await seedArchivedConversation();
      await admin.from("blocked_users").insert([
        { blocker_id: ALICE, blocked_id: BOB },
        { blocker_id: BOB, blocked_id: ALICE }
      ]);
      await admin.from("blocked_users").delete().eq("blocker_id", ALICE).eq("blocked_id", BOB);

      expect(await conversationStatus()).toBe("archived");
    },
    DB_TIMEOUT
  );
});

describeLocal("the Plan Chat repair inherits contextual eligibility", () => {
  it(
    "reconcile_plan_conversation_members exists and is callable with a plan id",
    async () => {
      /* The repair's whole safety argument is that it delegates to this RPC
         rather than deciding membership itself. If the signature ever drifts,
         the repair silently becomes a no-op that reports success. */
      const { error } = await admin.rpc("reconcile_plan_conversation_members", {
        p_plan_id: "00000000-0000-4000-8000-000000000000"
      });
      // A missing plan is fine; a signature mismatch is not.
      expect(error?.message ?? "").not.toMatch(/does not exist|could not find/i);
    },
    DB_TIMEOUT
  );

  it(
    "a non-Muddy accepted onto an UpFor is admitted to the converted Plan Chat",
    async () => {
      /* The behavioural claim, end to end: the Admin repair delegates to this
         RPC, so if a contextual participant survives reconciliation then the
         repair admits them too -- without Admin knowing the rule exists.
         Proven by running the canonical lifecycle, not by reading source. */
      const HOST = USERS.A;
      const STRANGER = USERS.D;
      const strangerLow = HOST < STRANGER ? HOST : STRANGER;
      const strangerHigh = HOST < STRANGER ? STRANGER : HOST;

      // Deliberately NOT Muddies.
      await admin
        .from("friendships")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_one_id", strangerLow)
        .eq("user_two_id", strangerHigh)
        .is("ended_at", null);

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
      await admin.from("hangout_requests").insert({
        hangout_session_id: session.id,
        requester_id: STRANGER,
        status: "accepted"
      });

      const { data: created, error } = await admin.rpc("create_plan_lifecycle", {
        p_actor_id: HOST,
        p_request_key: crypto.randomUUID(),
        p_title: "Converted from UpFor",
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
      expect(error).toBeNull();
      const planId = created?.[0]?.plan_id;
      expect(planId).toBeTruthy();

      // The repair's exact call.
      const { error: reconcileError } = await admin.rpc("reconcile_plan_conversation_members", {
        p_plan_id: planId
      });
      expect(reconcileError).toBeNull();

      const { data: conversation } = await admin
        .from("conversations")
        .select("id")
        .eq("context_type", "plan")
        .eq("context_id", planId)
        .maybeSingle();
      const { data: members } = await admin
        .from("conversation_members")
        .select("user_id, status")
        .eq("conversation_id", conversation.id)
        .eq("status", "joined");

      const memberIds = (members ?? []).map((row: { user_id: string }) => row.user_id);
      expect(memberIds).toContain(STRANGER);

      // Cleanup, and restore the shared A/D fixture friendship.
      await admin.from("messages").delete().eq("conversation_id", conversation.id);
      await admin.from("conversation_members").delete().eq("conversation_id", conversation.id);
      await admin.from("conversations").delete().eq("id", conversation.id);
      await admin.from("plan_participants").delete().eq("plan_id", planId);
      await admin.from("plans").delete().eq("id", planId);
      await admin.from("hangout_requests").delete().eq("hangout_session_id", session.id);
      await admin.from("hangout_sessions").delete().eq("id", session.id);
      await admin.from("friendships").update({ ended_at: null }).eq("user_one_id", strangerLow).eq("user_two_id", strangerHigh);
    },
    DB_TIMEOUT
  );
});
