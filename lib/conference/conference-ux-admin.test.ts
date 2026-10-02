import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const detail = read("components/conference/conference-topic-page.tsx");
const feed = read("components/conference/conference-page.tsx");
const reports = read("app/(admin)/admin/reports/page.tsx");
const filters = read("components/admin/moderation/report-filter-bar.tsx");

describe("Conference discussion and moderation UX", () => {
  it("keeps the Voice composer inline above Voices instead of floating over them", () => {
    expect(detail).toContain('aria-label="Add your Voice"');
    expect(detail).toContain("setComposerOpen(true)");
    expect(detail).toContain("autoFocus");
    expect(detail.indexOf('aria-label="Add your Voice"')).toBeLessThan(detail.indexOf('aria-label="Voices"'));
    expect(detail).not.toContain('className="sticky bottom-[calc(var(--mobile-nav-height');
  });

  it("restores drafts after failed Topic or Voice posts and blocks same-tick double sends", () => {
    expect(detail).toContain("sendingRef.current");
    expect(detail).toContain("setBody(text)");
    expect(detail).toContain("setComposerOpen(true)");
    expect(feed).toContain("postingRef.current");
    expect(feed).toContain("setBody(text)");
    expect(feed).toContain("setComposerOpen(true)");
  });

  it("labels Topic hiding correctly", () => {
    expect(detail).toContain("Hide this Topic");
  });

  it("makes Conference moderation discoverable inside the main audited admin reports system", () => {
    expect(reports).toContain("Conference moderation");
    expect(reports).toContain('type=conference');
    expect(reports).toContain('.in("content_type", ["conference_topic", "conference_reply"]');
    expect(filters).toContain('value: "conference"');
    expect(filters).toContain("Conference (Topics + Voices)");
  });
});
