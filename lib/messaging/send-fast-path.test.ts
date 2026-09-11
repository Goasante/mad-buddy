import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const composer = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
const shell = readFileSync("components/messaging/message-composer-v4-shell.tsx", "utf8");
const client = readFileSync("lib/messaging/send-client.ts", "utf8");
const route = readFileSync("app/api/messages/send/route.ts", "utf8");

describe("latency-sensitive message send transport", () => {
  it("uses the independent JSON route instead of the React Server Action queue", () => {
    expect(composer).toContain(
      'import { sendMessageViaApi as sendMessageAction } from "@/lib/messaging/send-client"'
    );
    expect(composer).not.toContain(
      'import { sendMessageAction } from "@/app/(app)/messaging-actions"'
    );
    expect(client).toContain('"/api/messages/send"');
    expect(client).toContain('credentials: "same-origin"');
    expect(client).toContain('method: "POST"');
  });

  it("keeps the existing idempotency key on every API send", () => {
    const textSend = composer.slice(composer.indexOf("function sendText()"), composer.indexOf("const sendVoice"));
    expect(textSend).toContain("clientMessageId: send.clientMessageId");
    expect(route).toContain('.eq("client_message_id", input.clientMessageId)');
    expect(route).toContain('.eq("sender_id", userId)');
  });
});

describe("durable-row acknowledgement", () => {
  it("acknowledges a canonical row before notification/bookkeeping tail work", () => {
    expect(route).toContain("COMMIT_PROBE_DELAYS_MS");
    expect(route).toContain("findCommittedSend");
    expect(route).toContain("keepPostCommitWorkAlive(sendPromise)");
    expect(route).toContain("after(async () =>");
    expect(route).toContain('return { ok: true, message: "Sent.", messageId: data.id }');
  });

  it("never accepts a row from another conversation or another media payload", () => {
    expect(route).toContain("if (data.conversation_id !== input.conversationId) return null");
    expect(route).toContain("if (data.media_id !== (input.mediaId ?? null)) return null");
  });

  it("preserves the Home activation invalidation from the old Server Action path", () => {
    expect(route).toContain('revalidatePath("/dashboard")');
  });
});

describe("post-send reconciliation", () => {
  it("does not launch the page's full-thread reload after each composer send", () => {
    const handleSent = shell.slice(
      shell.indexOf("function handleSent()"),
      shell.indexOf("return (", shell.indexOf("function handleSent()"))
    );
    expect(handleSent).not.toContain("onSent()");
    expect(handleSent).not.toContain("refreshMessages");
  });

  it("clears the local/server draft and typing state immediately", () => {
    const handleSent = shell.slice(
      shell.indexOf("function handleSent()"),
      shell.indexOf("return (", shell.indexOf("function handleSent()"))
    );
    expect(handleSent).toContain('lastDraftRef.current = ""');
    expect(handleSent).toContain('void syncDraftToServer("")');
    expect(handleSent).toContain("onDraftCleared?.()");
    expect(handleSent).toContain("publishTyping(false)");
  });
});
