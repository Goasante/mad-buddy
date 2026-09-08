import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { signedUrlNeedsRefresh } from "@/lib/media/signed-url-lifecycle";
import { stripEphemeralSignedMediaUrls } from "@/lib/messaging/persisted-thread-media";
import type { ChatMessageView } from "@/lib/messaging/mobile";

const threadStore = readFileSync("lib/messaging/thread-store.ts", "utf8");
const attachmentImage = readFileSync("components/messaging/message-attachment-image.tsx", "utf8");
const attachments = readFileSync("lib/messaging/attachments.ts", "utf8");
const eventArtwork = readFileSync("components/events/event-artwork.tsx", "utf8");
const rankedAccordion = readFileSync("components/events/ranked-events-accordion.tsx", "utf8");
const rankedList = readFileSync("components/events/top-events-list.tsx", "utf8");
const eventMediaAction = readFileSync("app/(app)/event-media-actions.ts", "utf8");

describe("signed media URL lifecycle", () => {
  it("renews missing, malformed, expired and nearly-expired credentials", () => {
    const now = Date.parse("2026-09-08T15:00:00.000Z");
    expect(signedUrlNeedsRefresh(null, false, now)).toBe(true);
    expect(signedUrlNeedsRefresh("not-a-date", true, now)).toBe(true);
    expect(signedUrlNeedsRefresh("2026-09-08T15:00:10.000Z", true, now)).toBe(true);
    expect(signedUrlNeedsRefresh("2026-09-08T15:01:00.000Z", true, now)).toBe(false);
  });

  it("persists canonical attachment identity without signed Storage credentials", () => {
    const message = {
      id: "message-1",
      attachment: {
        mediaId: "media-1",
        thumbUrl: "https://storage.example/thumb?signed=yes",
        fullUrl: "https://storage.example/full?signed=yes",
        width: 100,
        height: 100,
        expiresAt: "2026-09-08T15:05:00.000Z"
      }
    } as unknown as ChatMessageView;

    const [stored] = stripEphemeralSignedMediaUrls([message]);
    expect(stored.attachment?.mediaId).toBe("media-1");
    expect(stored.attachment?.thumbUrl).toBeNull();
    expect(stored.attachment?.fullUrl).toBeNull();
    expect(stored.attachment?.expiresAt).toBe("2026-09-08T15:05:00.000Z");

    // Existing IndexedDB rows are sanitized on read and new rows on write.
    expect((threadStore.match(/stripEphemeralSignedMediaUrls\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("refreshes chat media before rendering an expired cached URL", () => {
    expect(attachmentImage).toContain("signedUrlNeedsRefresh");
    expect(attachmentImage).toContain("useEffect(() =>");
    expect(attachmentImage).toContain("refreshMessageAttachmentAction");
    expect(attachmentImage).toContain("if (!src || failed || needsFreshUrl)");
  });

  it("rechecks freshness when an already-mounted chat photo is opened", () => {
    const openMedia = attachmentImage.indexOf("const openMedia = useCallback");
    const freshness = attachmentImage.indexOf("signedUrlNeedsRefresh(attachment.expiresAt", openMedia);
    const renewal = attachmentImage.indexOf("await renew()", freshness);
    const open = attachmentImage.indexOf("onOpen();", renewal);
    expect(openMedia).toBeGreaterThan(-1);
    expect(freshness).toBeGreaterThan(openMedia);
    expect(renewal).toBeGreaterThan(freshness);
    expect(open).toBeGreaterThan(renewal);
    expect(attachmentImage).not.toContain("window.setTimeout");
  });

  it("keeps signed-credential refresh promises inside the mounted account surface", () => {
    const attachmentComponent = attachmentImage.indexOf("export function MessageAttachmentImage");
    expect(attachmentImage).toContain("const [refreshes] = useState");
    expect(attachmentImage.indexOf("const refreshes = new Map")).toBeGreaterThan(attachmentComponent);
    expect(eventArtwork).toContain("inFlightRefreshRef");
    expect(eventArtwork).not.toContain("const coverRefreshes = new Map");
  });

  it("fails closed before signing another participant's attachment when block authority errors", () => {
    const blockRead = attachments.indexOf('from("blocked_users")');
    const blockFailure = attachments.indexOf("if (blockError) return byId", blockRead);
    const signer = attachments.indexOf("createSignedUrls", blockRead);
    expect(blockRead).toBeGreaterThan(-1);
    expect(blockFailure).toBeGreaterThan(blockRead);
    expect(signer).toBeGreaterThan(blockFailure);
  });

  it("never leaves an expired Event cover as a browser broken-image glyph", () => {
    expect(eventArtwork).toContain("onError={() => void recoverBrokenCover()}");
    expect(eventArtwork).toContain("setRecovery({ eventId, sourceCoverUrl: coverUrl, url: null })");
    expect(eventArtwork).toContain("refreshEventCoverUrlAction");
  });

  it("caps Event cover recovery without keeping the final broken image visible", () => {
    expect(eventArtwork).toContain("MAX_COVER_RECOVERY_ATTEMPTS = 2");
    expect(eventArtwork).toContain("attempts >= MAX_COVER_RECOVERY_ATTEMPTS");
    const recovery = eventArtwork.indexOf("async function recoverBrokenCover");
    const fallback = eventArtwork.indexOf("setRecovery({ eventId, sourceCoverUrl: coverUrl, url: null })", recovery);
    const retryGate = eventArtwork.indexOf("!consumeRecoveryAttempt()", recovery);
    expect(fallback).toBeGreaterThan(recovery);
    expect(retryGate).toBeGreaterThan(fallback);
  });

  it("routes Home and ranked Event artwork through the resilient renderer", () => {
    expect(rankedAccordion).toContain("<EventArtwork");
    expect(rankedList).toContain("<EventArtwork");
    expect(rankedAccordion).not.toContain("src={event.media.url}");
    expect(rankedList).not.toContain("src={event.media.url}");
  });

  it("renews Event covers only after current-user and Event-access checks", () => {
    expect(eventMediaAction).toContain("getCurrentUserRecord()");
    expect(eventMediaAction).toContain("getEventForViewer(eventId, user.id)");
    expect(eventMediaAction).toContain('signMediaForAsset(admin, event.cover_media_id, "feed")');
  });
});
