import { beforeEach, expect, it, vi } from "vitest";
import { forwardMessageAction } from "@/app/(app)/messaging-forward-actions";
const mocks = vi.hoisted(() => ({ from: vi.fn(), access: vi.fn(), permission: vi.fn(), prepare: vi.fn(), send: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseServerEnv: () => ({ url: "url", serviceRoleKey: "configured" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/messaging/action-auth", () => ({ getAuthoritativeMessagingUserId: async () => "forwarder" }));
vi.mock("@/lib/messaging/service", () => ({ resolveConversationAccess: mocks.access, canSendMessage: mocks.permission }));
vi.mock("@/lib/messaging/forward-media", () => ({ prepareForwardedMedia: mocks.prepare }));
vi.mock("@/lib/messaging/mobile", () => ({ sendMessage: mocks.send }));
vi.mock("@/lib/admin/enforcement", () => ({ guardAction: mocks.guard }));
const sourceId = "11111111-1111-4111-8111-111111111111";
const destination = "22222222-2222-4222-8222-222222222222";
const otherDestination = "33333333-3333-4333-8333-333333333333";
const otherSourceId = "44444444-4444-4444-8444-444444444444";
let source: Record<string, unknown>;
let sources: Record<string, unknown>[];
beforeEach(() => {
  vi.resetAllMocks();
  source = { id: sourceId, conversation_id: "old-chat", message_type: "voice_note", text_content: null, media_id: "original", status: "sent", deleted_at: null };
  sources = [source];
  mocks.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, in: async () => ({ data: sources }), maybeSingle: async () => ({ data: null }) }; return q;
  });
  mocks.access.mockResolvedValue({ canView: true });
  mocks.permission.mockResolvedValue({ allowed: true });
  mocks.guard.mockResolvedValue({ allowed: true });
  mocks.prepare.mockResolvedValue({ ok: true, mediaId: "new-asset" });
  mocks.send.mockResolvedValue({ ok: true, messageId: "new-message" });
});
const forward = () => forwardMessageAction({ sourceMessageIds: [sourceId], targetConversationIds: [destination], operationId: crypto.randomUUID() });
it("sends a fresh audio attachment through the canonical sender", async () => {
  expect((await forward()).ok).toBe(true);
  expect(mocks.send).toHaveBeenCalledWith("forwarder", expect.objectContaining({ conversationId: destination, mediaId: "new-asset", text: undefined }), { forwardedFromMessageId: sourceId, deferFollowUp: true });
});
it("preserves text forwarding without preparing media", async () => {
  source.message_type = "text"; source.media_id = null; source.text_content = "Hello";
  expect((await forward()).ok).toBe(true);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith("forwarder", expect.objectContaining({ text: "Hello", mediaId: undefined }), { forwardedFromMessageId: sourceId, deferFollowUp: true });
});
it.each(["access", "permission", "guard"] as const)("refuses forwarding when %s is denied", async (kind) => {
  mocks[kind].mockResolvedValue({ canView: false, allowed: false, message: "Unavailable" });
  expect((await forward()).ok).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("forwards several messages to several chats in order within each chat", async () => {
  source.message_type = "text"; source.media_id = null; source.text_content = "First";
  sources.push({ ...source, id: otherSourceId, text_content: "Second" });
  const result = await forwardMessageAction({ sourceMessageIds: [sourceId, otherSourceId], targetConversationIds: [destination, otherDestination], operationId: crypto.randomUUID() });
  expect(result).toMatchObject({ ok: true, sent: 4, total: 4 });
  expect(result.sentClientMessageIds).toHaveLength(4);
  expect(new Set(result.sentClientMessageIds).size).toBe(4);
  expect(mocks.send.mock.calls.map((call) => [call[1].conversationId, call[1].text])).toEqual([
    [destination, "First"], [otherDestination, "First"], [destination, "Second"], [otherDestination, "Second"]
  ]);
});
it("reports partial sends and safely retries only missing pairs", async () => {
  source.message_type = "text"; source.media_id = null; source.text_content = "Hello";
  mocks.send.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
  const operationId = crypto.randomUUID();
  const input = { sourceMessageIds: [sourceId], targetConversationIds: [destination, otherDestination], operationId };
  const partial = await forwardMessageAction(input);
  expect(partial).toMatchObject({ ok: false, sent: 1, total: 2 });
  expect(partial.sentClientMessageIds).toEqual([`${operationId}:0:0`]);
  mocks.from.mockImplementation(() => {
    let key = "";
    const q = { select: () => q, eq: (column: string, value: string) => { if (column === "client_message_id") key = value; return q; }, in: async () => ({ data: sources }), maybeSingle: async () => ({ data: key.endsWith(":0:0") ? { conversation_id: destination, forwarded_from_message_id: sourceId } : null }) }; return q;
  });
  mocks.send.mockClear();
  expect(await forwardMessageAction({ ...input, retry: true })).toMatchObject({ ok: true, sent: 2, total: 2 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][1].conversationId).toBe(otherDestination);
});
it("refuses expired media", async () => {
  source.expires_at = "2000-01-01T00:00:00Z";
  expect((await forward()).ok).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("refuses messages older than the viewer's visible history", async () => {
  source.created_at = "2026-01-01T00:00:00Z";
  mocks.access.mockResolvedValue({ canView: true, historyVisibleFrom: "2026-02-01T00:00:00Z" });
  expect((await forward()).ok).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("does not send if copying the audio fails", async () => {
  mocks.prepare.mockResolvedValue({ ok: false, message: "Could not copy" });
  expect((await forward()).ok).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
