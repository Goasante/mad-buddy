import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Unread counts human messages, not administrative facts.
 *
 * THE RULE, one sentence:
 *   Unread = unread USER messages in JOINED conversations, excluding the
 *   viewer's own messages and system messages.
 *
 * THE DEFECT THIS PINS. `conversation_previews` filtered on sender, deletion
 * and read mark but never on message_type, so every Circle system event --
 * "Ama became an admin", a rename, a removal -- counted as unread mail. And
 * because those rows carry `sender_id = null`, and `null is distinct from
 * <uuid>` is TRUE in SQL, the existing "not my own" guard did not exclude them
 * either: the person who performed the action was shown unread mail about
 * their own administrative change.
 *
 * Measured in production before the fix: an account with zero unread messages
 * showed a Messages badge of 1 from a single member_promoted event, and the
 * badge total across accounts was 28 against a true value of 23.
 */

const rpc = readFileSync(
  "supabase/migrations/20260814120000_unread_excludes_system_events.sql",
  "utf8"
);

/** The unread subquery only -- the preview subquery deliberately differs. */
const unreadSubquery = rpc.slice(rpc.indexOf("select count(*)::integer as unread_count"), rpc.indexOf(") uc on true"));

describe("what unread counts", () => {
  it("excludes system messages", () => {
    expect(unreadSubquery).toContain("m2.message_type <> 'system'");
  });

  it("still excludes the viewer's own messages", () => {
    expect(unreadSubquery).toContain("m2.sender_id is distinct from p_user_id");
  });

  it("still excludes deleted messages", () => {
    expect(unreadSubquery).toContain("m2.deleted_at is null");
  });

  it("still respects the read mark", () => {
    expect(unreadSubquery).toContain("m2.created_at > coalesce(r.read_at");
  });
});

describe("what the fix deliberately leaves alone", () => {
  const previewSubquery = rpc.slice(
    rpc.indexOf("select m.text_content, m.message_type, m.created_at"),
    rpc.indexOf(") lm on true")
  );

  it("keeps system events in the inbox preview", () => {
    // A Circle whose newest activity is a rename should still preview it --
    // it simply is not unread mail. The preview must NOT gain the filter.
    expect(previewSubquery).not.toContain("message_type <> 'system'");
  });

  it("does not touch conversation ordering", () => {
    // last_message_at is written by the application, not by this function.
    expect(rpc).not.toContain("update public.conversations");
  });

  it("writes no data at all", () => {
    // The invited/system rows in production are valid state. This migration
    // changes arithmetic, never rows.
    for (const forbidden of ["delete from", "insert into", "update public.messages", "truncate"]) {
      expect(rpc.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("changes exactly one function and no table or policy", () => {
    expect(rpc).toContain("create or replace function public.conversation_previews");
    expect(rpc.toLowerCase()).not.toContain("alter table");
    expect(rpc.toLowerCase()).not.toContain("create policy");
    expect(rpc.toLowerCase()).not.toContain("drop ");
  });

  it("keeps the signature and grants identical", () => {
    /* The COMPLETE argument list, not a substring of it.
     *
     * Two problems with the previous assertion, both found while releasing.
     * It embedded a literal \n, so a clean clone checking out CRLF failed on a
     * byte-identical file. And `.toContain` is a substring test, so appending
     * a third parameter -- exactly the breaking change this guards against --
     * still matched and the test passed.
     *
     * Matching the argument list up to its closing paren catches both: line
     * endings are normalised, and nothing can be added without failing. */
    // Normalise FIRST, then index. Taking indexOf from the raw string and
    // slicing the normalised one drifts by a byte per CRLF, which is how the
    // previous attempt still failed in a clean clone.
    const normalised = rpc.replace(/\r\n/g, "\n");
    const from = normalised.indexOf("public.conversation_previews(");
    const signature = normalised.slice(from, normalised.indexOf(")", from) + 1);
    expect(signature).toBe(
      "public.conversation_previews(\n  p_user_id uuid,\n  p_conversation_ids uuid[]\n)"
    );
    expect(rpc).toContain("grant execute on function public.conversation_previews(uuid, uuid[]) to service_role");
    expect(rpc).toContain("revoke all on function public.conversation_previews(uuid, uuid[]) from public, anon, authenticated");
  });
});

describe("the classification the app already agreed on", () => {
  const rules = readFileSync("lib/messaging/rules.ts", "utf8");
  const actions = readFileSync("lib/messaging/message-actions.ts", "utf8");

  it("treats system messages as non-user content elsewhere too", () => {
    // The unread subquery was the ONE place that disagreed with these.
    expect(rules).toContain('input.messageType === "system"');
    expect(actions).toContain('subject.messageType === "system"');
  });

  it("still creates system events with no sender", () => {
    // Which is exactly why "not my own message" could never exclude them, and
    // why the message_type predicate rather than the sender one is the fix.
    expect(readFileSync("lib/messaging/service.ts", "utf8")).toContain("sender_id: null");
  });
});
