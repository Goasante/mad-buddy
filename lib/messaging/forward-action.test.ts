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
let source: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  source = { id: sourceId, conversation_id: "old-chat", message_type: "voice_note", text_content: null, media_id: "original", status: "sent", deleted_at: null };
  mocks.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, update: () => q, maybeSingle: async () => ({ data: source }) }; return q;
  });
  mocks.access.mockResolvedValue({ canView: true });
  mocks.permission.mockResolvedValue({ allowed: true });
  mocks.guard.mockResolvedValue({ allowed: true });
  mocks.prepare.mockResolvedValue({ ok: true, mediaId: "new-asset" });
  mocks.send.mockResolvedValue({ ok: true, messageId: "new-message" });
});
const forward = () => forwardMessageAction({ sourceMessageId: sourceId, targetConversationIds: [destination] });
it("sends a fresh audio attachment through the canonical sender", async () => {
  expect((await forward()).ok).toBe(true);
  expect(mocks.send).toHaveBeenCalledWith("forwarder", expect.objectContaining({ conversationId: destination, mediaId: "new-asset", text: undefined }), { forwardedFromMessageId: sourceId });
});
it("preserves text forwarding without preparing media", async () => {
  source.message_type = "text"; source.media_id = null; source.text_content = "Hello";
  expect((await forward()).ok).toBe(true);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith("forwarder", expect.objectContaining({ text: "Hello", mediaId: undefined }), { forwardedFromMessageId: sourceId });
});
it.each(["access", "permission", "guard"] as const)("refuses forwarding when %s is denied", async (kind) => {
  mocks[kind].mockResolvedValue({ canView: false, allowed: false, message: "Unavailable" });
  expect((await forward()).ok).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("refuses expired media", async () => {
  source.expires_at = "2000-01-01T00:00:00Z";
  expect((await forward()).ok).toBe(false);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("does not send if copying the audio fails", async () => {
  mocks.prepare.mockResolvedValue({ ok: false, message: "Could not copy" });
  expect((await forward()).ok).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
