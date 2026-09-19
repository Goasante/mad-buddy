import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareForwardedMedia } from "./forward-media";
import { createChatUploadIntent, finalizeChatUpload } from "@/lib/media/chat-upload-service";

vi.mock("@/lib/media/chat-upload-service", () => ({ createChatUploadIntent: vi.fn(), finalizeChatUpload: vi.fn() }));
const asset = { id: "source", storage_key: "original/audio.webm", content_type: "audio/webm", size_bytes: 1000, duration_ms: 2100, waveform_data: [0.2, 0.5] };
function setup(found: typeof asset | null = asset, queued = false, copyFails = false) {
  const filters: unknown[][] = [];
  const copy = vi.fn().mockResolvedValue({ error: copyFails ? new Error("offline") : null });
  const admin = { storage: { from: () => ({ copy }) }, from(table: string) {
    const query = { select: () => query, eq: (...args: unknown[]) => { filters.push([table, ...args]); return query; }, is: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "media_assets" ? found : queued ? { id: "queued" } : null, error: null }) };
    return query;
  } };
  return { admin: admin as unknown as Parameters<typeof prepareForwardedMedia>[0], copy, filters };
}
const input = { mediaId: "source", sourceConversationId: "old-chat", conversationId: "new-chat", mediaKind: "voice_note" as const };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createChatUploadIntent).mockResolvedValue({ ok: true, intent: { mediaId: "copy", path: "forwarder/chat/copy.webm", token: "token", signedUrl: "url", expiresAt: "later" } });
  vi.mocked(finalizeChatUpload).mockResolvedValue({ ok: true, mediaId: "copy", mediaKind: "voice_note", durationMs: 2100, previewUrl: null });
});
describe("forwarded attachments", () => {
  it("copies audio to a new owner/conversation and preserves playback metadata", async () => {
    const { admin, copy, filters } = setup();
    expect(await prepareForwardedMedia(admin, "forwarder", input)).toEqual({ ok: true, mediaId: "copy" });
    expect(createChatUploadIntent).toHaveBeenCalledWith(admin, "forwarder", { conversationId: "new-chat", contentType: "audio/webm", sizeBytes: 1000, mediaKind: "voice_note" });
    expect(copy).toHaveBeenCalledWith("original/audio.webm", "forwarder/chat/copy.webm");
    expect(finalizeChatUpload).toHaveBeenCalledWith(admin, "forwarder", { conversationId: "new-chat", mediaId: "copy", expectedMediaKind: "voice_note", waveform: asset.waveform_data, clientDurationMs: 2100 });
    expect(filters).toContainEqual(["media_assets", "intended_conversation_id", "old-chat"]);
    expect(filters).toContainEqual(["media_assets", "moderation_status", "active"]);
  });
  it.each(["missing", "queued"])("refuses %s media before copying", async (state) => {
    const { admin, copy } = setup(state === "missing" ? null : asset, state === "queued");
    expect((await prepareForwardedMedia(admin, "forwarder", input)).ok).toBe(false);
    expect(copy).not.toHaveBeenCalled();
    expect(createChatUploadIntent).not.toHaveBeenCalled();
  });
  it("does not finalize a failed storage copy", async () => {
    const { admin } = setup(asset, false, true);
    expect((await prepareForwardedMedia(admin, "forwarder", input)).ok).toBe(false);
    expect(finalizeChatUpload).not.toHaveBeenCalled();
  });
  it("does not return an asset rejected by byte validation", async () => {
    const { admin } = setup();
    vi.mocked(finalizeChatUpload).mockResolvedValue({ ok: false, message: "Invalid audio" });
    expect(await prepareForwardedMedia(admin, "forwarder", input)).toEqual({ ok: false, message: "Invalid audio" });
  });
});
