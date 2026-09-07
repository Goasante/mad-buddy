import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * THE VERIFIERS, AGAINST THE REAL DATABASE.
 *
 * The unit tests hold the contract's shape. These hold the thing that actually
 * matters: that the verifier reads real state and reaches the RIGHT one of the
 * four outcomes -- in particular that a live block produces
 * `blocked_by_product_rule` and never `fixed`, because an operator who is told
 * "fixed" for a blocked pair will keep escalating a non-defect, and one who is
 * told "still broken" will go looking for a bug that does not exist.
 *
 * These exercise the same predicates the repairs use, against the same rows,
 * rather than importing the server actions (which require an admin session).
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

async function endFriendship() {
  await admin
    .from("friendships")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null);
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

/**
 * The direct-messaging repair's decision, isolated: which of the four outcomes
 * does this account's real state produce? Mirrors the branch structure in
 * app/(admin)/admin/repairs/actions.ts.
 */
async function classifyDirectMessaging(userId: string) {
  const [{ data: friendships }, { data: blocks }, { data: memberships }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
      .is("ended_at", null),
    admin.from("blocked_users").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
    admin.from("conversation_members").select("conversation_id").eq("user_id", userId)
  ]);

  const friendIds = new Set(
    (friendships ?? []).map((r: { user_one_id: string; user_two_id: string }) =>
      r.user_one_id === userId ? r.user_two_id : r.user_one_id
    )
  );
  const blockedIds = new Set(
    (blocks ?? []).map((r: { blocker_id: string; blocked_id: string }) =>
      r.blocker_id === userId ? r.blocked_id : r.blocker_id
    )
  );
  const eligible = new Set([...friendIds].filter((id) => !blockedIds.has(id)));

  if (eligible.size === 0) {
    /* Any standing block is enough. Blocking ENDS the friendship, so asking
       "is a blocked person still a Muddy" always answers no and would report
       "nothing to repair" for a pair whose real situation is a live block. */
    return blockedIds.size > 0 ? "blocked_by_product_rule" : "not_applicable";
  }

  const conversationIds = [...new Set((memberships ?? []).map((r: { conversation_id: string }) => r.conversation_id))];
  if (conversationIds.length === 0) return "not_applicable";

  const { data: conversations } = await admin
    .from("conversations")
    .select("id, direct_key, status")
    .eq("conversation_type", "direct")
    .in("id", conversationIds);

  /* Per-pair, exactly as the repair now reasons: an archived thread whose
     other side is blocked is a product rule, not drift. */
  const repairable: string[] = [];
  let blockedArchived = 0;
  for (const c of conversations ?? []) {
    const pair = (c.direct_key as string)?.split(":") ?? [];
    const other = pair[0] === userId ? pair[1] : pair[0];
    if (!other || c.status !== "archived") continue;
    if (blockedIds.has(other)) {
      blockedArchived += 1;
      continue;
    }
    if (eligible.has(other)) repairable.push(c.id);
  }

  if (repairable.length > 0) return "repairable";
  return blockedArchived > 0 ? "blocked_by_product_rule" : "not_applicable";
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

describeLocal("a live block is a product rule, not a failure", () => {
  it(
    "a blocked pair classifies as blocked_by_product_rule, never as fixed",
    async () => {
      await seedArchivedConversation();
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });

      const outcome = await classifyDirectMessaging(ALICE);

      expect(outcome).toBe("blocked_by_product_rule");
      expect(outcome).not.toBe("repairable");
    },
    DB_TIMEOUT
  );

  it(
    "it reads the same from the blocked side, so neither operator is misled",
    async () => {
      await seedArchivedConversation();
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });

      expect(await classifyDirectMessaging(BOB)).toBe("blocked_by_product_rule");
    },
    DB_TIMEOUT
  );
});

describeLocal("nothing-to-repair is distinguished from a real fault", () => {
  it(
    "a healthy account with an active conversation is not_applicable",
    async () => {
      const id = await seedArchivedConversation();
      await admin.from("conversations").update({ status: "active" }).eq("id", id);

      expect(await classifyDirectMessaging(ALICE)).toBe("not_applicable");
    },
    DB_TIMEOUT
  );

  it(
    "an account with no Muddies at all is not_applicable, not blocked",
    async () => {
      await endFriendship();

      expect(await classifyDirectMessaging(ALICE)).toBe("not_applicable");
    },
    DB_TIMEOUT
  );

  it(
    "genuine legacy drift IS repairable, so the backstop still has work to do",
    async () => {
      await seedArchivedConversation();

      expect(await classifyDirectMessaging(ALICE)).toBe("repairable");
    },
    DB_TIMEOUT
  );
});

describeLocal("the invariant the verifier re-reads", () => {
  it(
    "requires BOTH an active conversation and two joined members",
    async () => {
      const id = await seedArchivedConversation();
      await admin.from("conversations").update({ status: "active" }).eq("id", id);
      // Active, but one side left: sending still fails, so this is not FIXED.
      await admin
        .from("conversation_members")
        .update({ status: "left" })
        .eq("conversation_id", id)
        .eq("user_id", BOB);

      const { data: convo } = await admin.from("conversations").select("status").eq("id", id).single();
      const { data: members } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", id)
        .eq("status", "joined");

      const wouldReportFixed = convo.status === "active" && (members ?? []).length >= 2;
      expect(wouldReportFixed).toBe(false);
    },
    DB_TIMEOUT
  );

  it(
    "and reports fixed only when both hold",
    async () => {
      const id = await seedArchivedConversation();
      await admin.from("conversations").update({ status: "active" }).eq("id", id);

      const { data: convo } = await admin.from("conversations").select("status").eq("id", id).single();
      const { data: members } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", id)
        .eq("status", "joined");

      expect(convo.status === "active" && (members ?? []).length >= 2).toBe(true);
    },
    DB_TIMEOUT
  );
});
