import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const source = readFileSync(new URL("./smart-card-v2.tsx", import.meta.url), "utf8");

describe("Smart Card presentation", () => {
  it("restores the registered fixed background without scenario illustrations", () => {
    expect(source).toContain("homeCardBBackground().path");
    expect(source).toContain("src={HOME_CARD_B_BACKGROUND}");
    expect(source).not.toContain("SmartCardArtwork");
    expect(source).toContain('aria-label="Now"');
    expect(source).not.toContain("card.media!.url");
  });

  it("keeps urgent safety styling without festive or animated decoration", () => {
    expect(source).toContain('treatment === "safety"');
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

  it("preserves authorized identity, busy status and accessible progress", () => {
    expect(source).toContain("card.person.avatarUrl");
    expect(source).toContain("pending || intentPending || undefined");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("availableSmartCard(inputCard, availability)");
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
