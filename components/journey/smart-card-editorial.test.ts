import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./smart-card-v2.tsx", import.meta.url), "utf8");

describe("Smart Card editorial presentation", () => {
  it("uses the approved neutral illustration atlas as fallback art", () => {
    expect(source).toContain('/visuals/smart-card/editorial-atlas.webp');
    expect(source).toContain('backgroundSize: "300% 200%"');
    expect(source).toContain('data-smart-card-editorial="true"');
  });

  it("keeps truthful media ahead of fallback illustration", () => {
    expect(source).toContain('const hasTruthfulMedia = treatment === "media"');
    expect(source).toContain('src={card.media!.url}');
  });

  it("does not infer gender from names", () => {
    expect(source).toContain("a display name is never a gender authority");
    expect(source).toContain("mixed/neutral");
  });

  it("preserves the authorized click-time conversation intent", () => {
    expect(source).toContain("openDirectConversationAction(intent.targetUserId)");
    expect(source).toContain("conversationHref(result.conversationId)");
    expect(source).toContain("card.primaryIntent");
  });
});
