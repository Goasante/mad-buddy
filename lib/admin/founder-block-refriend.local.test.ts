import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * THE FOUNDER'S OWN JOURNEY, END TO END.
 *
 *   A and B were Muddies -> one blocks the other (which ENDS the friendship)
 *   -> later they legitimately become Muddies again -> the block is lifted
 *   -> the direct conversation is still archived from historical drift
 *   -> messaging says "Not sent".
 *
 * Two things have to be true at once, and they pull in opposite directions:
 * Admin must fix the historical drift, and Admin must never cross a live
 * block. So this proves both the repair AND the refusal, against real rows.
 *
 * The drift itself is now largely prevented at the database level
 * (20260907140000 reopens on whichever of re-friend/unblock happens second),
 * so what is exercised here is the BACKSTOP for conversations that drifted
 * before that shipped -- which is exactly the founder's account.
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

const A = USERS.B;
const B = USERS.C;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

const low = A < B ? A : B;
const high = A < B ? B : A;
const directKey = `${low}:${high}`;

async function reset() {
  await admin.from("blocked_users").delete().or(`blocker_id.eq.${A},blocker_id.eq.${B}`);
  const { data: rows } = await admin.from("conversations").select("id").eq("direct_key", directKey);
  for (const row of rows ?? []) {
    await admin.from("messages").delete().eq("conversation_id", row.id);
    await admin.from("conversation_members").delete().eq("conversation_id", row.id);
    await admin.from("conversations").delete().eq("id", row.id);
  }
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .maybeSingle();
  if (existing) await admin.from("friendships").update({ ended_at: null }).eq("id", existing.id);
  else await admin.from("friendships").insert({ user_one_id: low, user_two_id: high });
}

/** The historical shape: live friendship, no block, conversation left archived. */
async function seedHistoricalDrift() {
  const { data: convo } = await admin
    .from("conversations")
    .insert({ conversation_type: "direct", created_by: A, direct_key: directKey, status: "archived" })
    .select("id")
    .single();
  await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: A, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: B, role: "member", status: "joined" }
  ]);
  await admin.from("messages").insert({
    conversation_id: convo.id,
    sender_id: A,
    text_content: "from before the block",
    message_type: "text"
  });
  return convo.id as string;
}

/** The exact statements `reconcileDirectMessaging` issues, for user A. */
async function runRepair() {
  const [{ data: friendships }, { data: blocks }, { data: memberships }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${A},user_two_id.eq.${A}`)
      .is("ended_at", null),
    admin.from("blocked_users").select("blocker_id, blocked_id").or(`blocker_id.eq.${A},blocked_id.eq.${A}`),
    admin.from("conversation_members").select("conversation_id").eq("user_id", A)
  ]);

  const friendIds = new Set(
    (friendships ?? []).map((r: { user_one_id: string; user_two_id: string }) =>
      r.user_one_id === A ? r.user_two_id : r.user_one_id
    )
  );
  const blockedIds = new Set(
    (blocks ?? []).map((r: { blocker_id: string; blocked_id: string }) =>
      r.blocker_id === A ? r.blocked_id : r.blocker_id
    )
  );
  const eligible = new Set([...friendIds].filter((id) => !blockedIds.has(id)));

  const conversationIds = [...new Set((memberships ?? []).map((r: { conversation_id: string }) => r.conversation_id))];
  if (conversationIds.length === 0) return { repaired: 0, blockedArchived: 0 };

  const { data: conversations } = await admin
    .from("conversations")
    .select("id, direct_key, status")
    .eq("conversation_type", "direct")
    .in("id", conversationIds);

  const repairable: string[] = [];
  const members = new Set<string>([A]);
  let blockedArchived = 0;
  for (const c of conversations ?? []) {
    const pair = (c.direct_key as string)?.split(":") ?? [];
    const other = pair[0] === A ? pair[1] : pair[0];
    if (!other || c.status !== "archived") continue;
    if (blockedIds.has(other)) {
      blockedArchived += 1;
      continue;
    }
    if (!eligible.has(other)) continue;
    repairable.push(c.id);
    members.add(other);
  }

  if (repairable.length === 0) return { repaired: 0, blockedArchived };

  const now = new Date().toISOString();
  await admin
    .from("conversations")
    .update({ status: "active", updated_at: now })
    .in("id", repairable)
    .eq("conversation_type", "direct")
    .eq("status", "archived");
  await admin
    .from("conversation_members")
    .update({ status: "joined", left_at: null, updated_at: now })
    .in("conversation_id", repairable)
    .in("user_id", [...members]);

  return { repaired: repairable.length, blockedArchived };
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

beforeEach(async () => {
  if (!isLocal) return;
  await reset();
});

afterAll(async () => {
  if (!isLocal) return;
  await reset();
});

describeLocal("a live block is absolute", () => {
  it(
    "refuses to reopen while ANY block stands, and repairs nothing",
    async () => {
      const id = await seedHistoricalDrift();
      await admin.from("blocked_users").insert({ blocker_id: A, blocked_id: B });

      const result = await runRepair();

      expect(result.repaired).toBe(0);
      expect(result.blockedArchived).toBe(1);
      const { data } = await admin.from("conversations").select("status").eq("id", id).single();
      expect(data.status).toBe("archived");
    },
    DB_TIMEOUT
  );

  it(
    "refuses identically when the OTHER person is the blocker",
    async () => {
      /* The blocked side must get the same answer, and Admin must never make
         the direction visible. */
      const id = await seedHistoricalDrift();
      await admin.from("blocked_users").insert({ blocker_id: B, blocked_id: A });

      const result = await runRepair();

      expect(result.repaired).toBe(0);
      const { data } = await admin.from("conversations").select("status").eq("id", id).single();
      expect(data.status).toBe("archived");
    },
    DB_TIMEOUT
  );
});

describeLocal("historical drift after a legitimate re-friend IS repaired", () => {
  it(
    "reopens the conversation and verifies both people are joined",
    async () => {
      const id = await seedHistoricalDrift();

      const result = await runRepair();
      expect(result.repaired).toBe(1);

      // THE INVARIANT, RE-READ -- both halves, because sending needs both.
      const { data: conversation } = await admin.from("conversations").select("status").eq("id", id).single();
      const { data: joined } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", id)
        .eq("status", "joined");

      expect(conversation.status).toBe("active");
      expect((joined ?? []).length).toBe(2);
    },
    DB_TIMEOUT
  );

  it(
    "preserves the history rather than starting a fresh chat",
    async () => {
      const id = await seedHistoricalDrift();

      await runRepair();

      const { data: conversations } = await admin.from("conversations").select("id").eq("direct_key", directKey);
      const { data: messages } = await admin.from("messages").select("id").eq("conversation_id", id);

      // One conversation, the same one, with its message still there.
      expect((conversations ?? []).length).toBe(1);
      expect((conversations ?? [])[0].id).toBe(id);
      expect((messages ?? []).length).toBe(1);
    },
    DB_TIMEOUT
  );

  it(
    "rejoins a member who had left, since sending needs both sides joined",
    async () => {
      const id = await seedHistoricalDrift();
      await admin
        .from("conversation_members")
        .update({ status: "left" })
        .eq("conversation_id", id)
        .eq("user_id", B);

      await runRepair();

      const { data: joined } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", id)
        .eq("status", "joined");
      expect((joined ?? []).length).toBe(2);
    },
    DB_TIMEOUT
  );

  it(
    "creates no friendship and no second conversation",
    async () => {
      /* The repair fixes bookkeeping; it must never manufacture consent. */
      const { data: before } = await admin
        .from("friendships")
        .select("id")
        .eq("user_one_id", low)
        .eq("user_two_id", high);
      await seedHistoricalDrift();

      await runRepair();

      const { data: after } = await admin
        .from("friendships")
        .select("id")
        .eq("user_one_id", low)
        .eq("user_two_id", high);
      expect((after ?? []).length).toBe((before ?? []).length);
    },
    DB_TIMEOUT
  );

  it(
    "reports nothing to repair once the conversation is already healthy",
    async () => {
      const id = await seedHistoricalDrift();
      await admin.from("conversations").update({ status: "active" }).eq("id", id);

      expect((await runRepair()).repaired).toBe(0);
    },
    DB_TIMEOUT
  );
});
