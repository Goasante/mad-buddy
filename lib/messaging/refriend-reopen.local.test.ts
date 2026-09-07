import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * BLOCK -> UNBLOCK -> RE-FRIEND -> SEND, IN EITHER ORDER.
 *
 * The founder reproduced "Not sent" on a real phone between two people who
 * were Muddies again and had no block between them. The existing harness
 * (scripts/hardening/block-unblock-readd.mjs) passed 13/13, because it only
 * ever tested ONE ordering: unblock, then re-friend.
 *
 * The BETA-001 reopen fires on `friendships` and correctly declines while a
 * block is still live. So the reopen only happened when the friendship was the
 * LAST of the two events. The other ordering --
 *
 *     block -> re-friend (declines, block still live) -> unblock (nothing runs)
 *
 * -- left the pair as Muddies, unblocked, with an `archived` conversation, and
 * `resolveCanSendMessage` refuses every send with `conversation_closed`. That
 * is the "Not sent" the founder saw.
 *
 * These cases hold BOTH orderings, and hold the limits that must not move:
 * unblocking alone restores nothing, one side lifting a mutual block restores
 * nothing, and a live block always outranks a friendship.
 *
 * Against the real local database, and through the real service functions --
 * raw table writes are exactly what hid this.
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
let canSendMessage: typeof import("@/lib/messaging/service").canSendMessage;
let getOrCreateDirectConversation: typeof import("@/lib/messaging/service").getOrCreateDirectConversation;

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

async function endFriendship() {
  await admin
    .from("friendships")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null);
}

/* Reactivates the SAME row when one exists -- the shape accept_friend_request
   produces, so the trigger sees the real transition rather than a fresh row. */
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

/** A live direct conversation with one message of history in it. */
async function seedConversation() {
  const { data: convo } = await admin
    .from("conversations")
    .insert({ conversation_type: "direct", created_by: ALICE, direct_key: directKey, status: "active" })
    .select("id")
    .single();
  await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: ALICE, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: BOB, role: "member", status: "joined" }
  ]);
  await admin
    .from("messages")
    .insert({
      conversation_id: convo.id,
      sender_id: ALICE,
      text_content: "before the block",
      message_type: "text"
    });
  return convo.id as string;
}

/** blockUserAction's database effects, in its order. */
async function block(blocker: string, blocked: string) {
  await admin.from("blocked_users").insert({ blocker_id: blocker, blocked_id: blocked });
  await endFriendship();
  await admin
    .from("conversations")
    .update({ status: "archived" })
    .eq("direct_key", directKey)
    .eq("conversation_type", "direct");
}

async function unblock(blocker: string, blocked: string) {
  await admin.from("blocked_users").delete().eq("blocker_id", blocker).eq("blocked_id", blocked);
}

async function conversationStatus() {
  const { data } = await admin.from("conversations").select("status").eq("direct_key", directKey).maybeSingle();
  return data?.status ?? null;
}

async function joinedCount(conversationId: string) {
  const { data } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("status", "joined");
  return (data ?? []).length;
}

async function messageCount(conversationId: string) {
  const { data } = await admin.from("messages").select("id").eq("conversation_id", conversationId);
  return (data ?? []).length;
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
  const service = await import("@/lib/messaging/service");
  canSendMessage = service.canSendMessage;
  getOrCreateDirectConversation = service.getOrCreateDirectConversation;
});

beforeEach(async () => {
  if (!isLocal) return;
  await clearBlocks();
  await clearConversation();
  await makeFriends();
});

afterAll(async () => {
  if (!isLocal) return;
  /* Put the shared fixture back: these two start as Muddies with no block and
     no direct conversation. A suite that mutates shared state has to restore
     it, or it fails its neighbours instead of itself. */
  await clearBlocks();
  await clearConversation();
  await makeFriends();
});

describeLocal("re-friend after a block restores the conversation, in either order", () => {
  it(
    "THE REPORTED DEFECT: re-friend BEFORE unblock still leaves the pair able to send",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);

      // The founder's ordering: the relationship is repaired first, while the
      // block is still standing, and the block is lifted afterwards.
      await makeFriends();
      expect(await conversationStatus()).toBe("archived"); // block still outranks

      await unblock(ALICE, BOB);

      expect(await conversationStatus()).toBe("active");
      const permission = await canSendMessage(admin, ALICE, conversationId);
      expect(permission).toEqual({ allowed: true, reason: "allowed" });
    },
    DB_TIMEOUT
  );

  it(
    "the already-covered ordering still works: unblock, then re-friend",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await unblock(ALICE, BOB);
      await makeFriends();

      expect(await conversationStatus()).toBe("active");
      expect((await canSendMessage(admin, ALICE, conversationId)).allowed).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "the recipient can send too, not just the person who lifted the block",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      expect((await canSendMessage(admin, BOB, conversationId)).allowed).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "history survives the whole round trip -- blocking is an ending, not an erasure",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      expect(await messageCount(conversationId)).toBe(1);
    },
    DB_TIMEOUT
  );

  it(
    "both sides are still joined afterwards",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      expect(await joinedCount(conversationId)).toBe(2);
    },
    DB_TIMEOUT
  );

  it(
    "it is the SAME conversation, not a replacement",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      const { data } = await admin.from("conversations").select("id").eq("direct_key", directKey);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(conversationId);
    },
    DB_TIMEOUT
  );

  it(
    "a member who had LEFT is rejoined when the relationship returns",
    async () => {
      const conversationId = await seedConversation();
      await admin
        .from("conversation_members")
        .update({ status: "left" })
        .eq("conversation_id", conversationId)
        .eq("user_id", BOB);
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      expect(await joinedCount(conversationId)).toBe(2);
    },
    DB_TIMEOUT
  );
});

describeLocal("what unblocking must NOT do", () => {
  it(
    "unblocking alone does not restore the friendship",
    async () => {
      await seedConversation();
      await block(ALICE, BOB);
      await unblock(ALICE, BOB);

      const { data } = await admin
        .from("friendships")
        .select("ended_at")
        .eq("user_one_id", low)
        .eq("user_two_id", high)
        .maybeSingle();
      expect(data?.ended_at).not.toBeNull();
    },
    DB_TIMEOUT
  );

  it(
    "unblocking alone does not reopen the conversation",
    async () => {
      await seedConversation();
      await block(ALICE, BOB);
      await unblock(ALICE, BOB);

      expect(await conversationStatus()).toBe("archived");
    },
    DB_TIMEOUT
  );

  it(
    "unblocking alone leaves sending refused",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await unblock(ALICE, BOB);

      const permission = await canSendMessage(admin, ALICE, conversationId);
      expect(permission.allowed).toBe(false);
    },
    DB_TIMEOUT
  );

  it(
    "unblocking never CREATES a conversation for a pair that never had one",
    async () => {
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      const { data } = await admin.from("conversations").select("id").eq("direct_key", directKey);
      expect(data ?? []).toHaveLength(0);
    },
    DB_TIMEOUT
  );
});

describeLocal("a live block always outranks a friendship", () => {
  it(
    "one side lifting a MUTUAL block restores nothing",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await admin.from("blocked_users").insert({ blocker_id: BOB, blocked_id: ALICE });
      await makeFriends();

      await unblock(ALICE, BOB); // Bob still blocks Alice.

      expect(await conversationStatus()).toBe("archived");
      expect((await canSendMessage(admin, ALICE, conversationId)).allowed).toBe(false);
    },
    DB_TIMEOUT
  );

  it(
    "the conversation opens only once the LAST block is gone",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await admin.from("blocked_users").insert({ blocker_id: BOB, blocked_id: ALICE });
      await makeFriends();
      await unblock(ALICE, BOB);
      await unblock(BOB, ALICE);

      expect(await conversationStatus()).toBe("active");
      expect((await canSendMessage(admin, ALICE, conversationId)).allowed).toBe(true);
    },
    DB_TIMEOUT
  );

  it(
    "re-blocking after a restored conversation closes it again",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);
      expect(await conversationStatus()).toBe("active");

      await block(ALICE, BOB);

      expect(await conversationStatus()).toBe("archived");
      expect((await canSendMessage(admin, ALICE, conversationId)).allowed).toBe(false);
    },
    DB_TIMEOUT
  );

  it(
    "a blocked pair cannot open a direct conversation through the service either",
    async () => {
      await block(ALICE, BOB);
      await makeFriends();

      const result = await getOrCreateDirectConversation(admin, ALICE, BOB);
      expect(result.conversationId).toBeNull();
      expect(result.error).toBe("blocked");
    },
    DB_TIMEOUT
  );

  it(
    "unblocking a pair who are NOT friends leaves them unable to message",
    async () => {
      await seedConversation();
      await block(ALICE, BOB);
      await unblock(ALICE, BOB);
      // Still not friends: the friendship stays ended.

      const result = await getOrCreateDirectConversation(admin, ALICE, BOB);
      expect(result.conversationId).toBeNull();
      expect(result.error).toBe("not_muddies");
    },
    DB_TIMEOUT
  );
});

describeLocal("the reopen is narrow", () => {
  it(
    "deleting a block between strangers with no conversation does nothing at all",
    async () => {
      await endFriendship();
      await admin.from("blocked_users").insert({ blocker_id: ALICE, blocked_id: BOB });
      await unblock(ALICE, BOB);

      const { data } = await admin.from("conversations").select("id").eq("direct_key", directKey);
      expect(data ?? []).toHaveLength(0);
    },
    DB_TIMEOUT
  );

  it(
    "a conversation restricted for some OTHER reason is not resurrected by an unblock",
    async () => {
      const conversationId = await seedConversation();
      await block(ALICE, BOB);
      await makeFriends();
      /* Set AFTER the friendship is live, so the only event still to come is
         the unblock -- otherwise the friendship trigger reopens it first and
         the case proves nothing about this one. `restricted`, not `archived`:
         a real status the reopen has no business touching. */
      await admin.from("conversations").update({ status: "restricted" }).eq("id", conversationId);

      await unblock(ALICE, BOB);

      expect(await conversationStatus()).toBe("restricted");
    },
    DB_TIMEOUT
  );

  it(
    "an unblock touches only THIS pair's conversation",
    async () => {
      await seedConversation();
      /* Clear first: an aborted earlier run can leave this row behind, and the
         unique direct_key would then fail this case for the wrong reason. */
      const otherKey = [USERS.A, USERS.D].sort().join(":");
      const { data: stale } = await admin.from("conversations").select("id").eq("direct_key", otherKey);
      for (const row of stale ?? []) {
        await admin.from("conversation_members").delete().eq("conversation_id", row.id);
        await admin.from("messages").delete().eq("conversation_id", row.id);
        await admin.from("conversations").delete().eq("id", row.id);
      }
      const { data: other } = await admin
        .from("conversations")
        .insert({
          conversation_type: "direct",
          created_by: USERS.A,
          direct_key: otherKey,
          status: "archived"
        })
        .select("id")
        .single();

      await block(ALICE, BOB);
      await makeFriends();
      await unblock(ALICE, BOB);

      const { data: untouched } = await admin.from("conversations").select("status").eq("id", other.id).single();
      expect(untouched.status).toBe("archived");
      expect(await conversationStatus()).toBe("active");

      await admin.from("conversation_members").delete().eq("conversation_id", other.id);
      await admin.from("conversations").delete().eq("id", other.id);
    },
    DB_TIMEOUT
  );
});
