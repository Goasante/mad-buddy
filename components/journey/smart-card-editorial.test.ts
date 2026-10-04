import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const source = readFileSync(new URL("./smart-card-v2.tsx", import.meta.url), "utf8");

describe("Smart Card presentation", () => {
  it("uses the compact illustrated panel instead of a scenic background", () => {
    expect(source).toContain("<SmartCardArtwork card={card}");
    expect(source).toContain('aria-label="Now"');
    expect(source).not.toContain("homeCardBBackground");
    expect(source).not.toContain("card.media!.url");
  });

  it("keeps urgent safety styling without festive or animated decoration", () => {
    expect(source).toContain('card.id === "safe_arrival"');
    expect(source).not.toMatch(/<video|autoPlay|PrismBackground|GlareHover/);
  });

  it("does not infer gender from names", () => {
    expect(source).toContain("a display name is never a gender authority");
  });

  it("preserves the authorized click-time conversation intent", () => {
    expect(source).toContain("openDirectConversationAction(intent.targetUserId)");
    expect(source).toContain("conversationHref(result.conversationId)");
    expect(source).toContain("card.primaryIntent");
  });

  it("renders heartbeat metadata by meaning rather than giving every fact a calendar icon", () => {
    expect(source).toContain('card.metaKind === "location"');
    expect(source).toContain('card.metaKind === "decision"');
    expect(source).toContain('card.metaKind === "time" || card.metaKind === "status"');
    expect(source).toContain("CircleHelp");
    expect(source).toContain("Clock");
  });

  it("refreshes Home when a time-bound heartbeat stops being true", () => {
    expect(source).toContain("card.expiresAt");
    expect(source).toContain("router.refresh()");
    expect(source).toContain("window.setTimeout");
    expect(source).toContain("scheduleUntilBoundary");
    expect(source).toContain("MAX_BROWSER_TIMEOUT_MS");
    expect(source).toContain("HEARTBEAT_REFRESH_RETRIES");
  });
});
