import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conferenceHotScore,
  isConferenceTopicSuppressed,
  isConferenceVoiceCollapsed
} from "@/lib/conference/ranking";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261002123000_conference_activity_architecture.sql");
const server = read("lib/conference/server.ts");
const feed = read("components/conference/conference-page.tsx");
const detail = read("components/conference/conference-topic-page.tsx");
const actions = read("app/(app)/conference-actions.ts");
const css = read("components/conference/conference-page.module.css");

describe("Conference activity architecture", () => {
  it("archives on sustained inactivity instead of a hard creation-age deadline", () => {
    expect(migration).toContain("last_activity_at");
    expect(migration).toContain("new.created_at + interval '7 days'");
    expect(migration).toContain("now() + interval '7 days'");
    expect(server).toContain('.order("last_activity_at", { ascending: false })');
    expect(server).not.toContain('.gte("created_at", cutoffIso)');
  });

  it("lets Voices and Hypes reheat a Topic but never lets Pass extend its life", () => {
    expect(migration).toContain("conference_reply_activity");
    expect(migration).toContain("conference_hype_activity");
    expect(migration).toContain("if new.value <> 1");
    expect(migration).toContain("Pass affects score");
  });

  it("removes a Topic from discovery at the agreed net -5 approval score", () => {
    expect(isConferenceTopicSuppressed({ hypeCount: 0, passCount: 4 })).toBe(false);
    expect(isConferenceTopicSuppressed({ hypeCount: 0, passCount: 5 })).toBe(true);
    expect(isConferenceTopicSuppressed({ hypeCount: 4, passCount: 8 })).toBe(false);
    expect(isConferenceTopicSuppressed({ hypeCount: 4, passCount: 9 })).toBe(true);
  });

  it("keeps Hot Hype-led while Voices contribute capped momentum", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const recent = "2026-10-02T12:00:00Z";
    const hypeLed = conferenceHotScore(
      { hypeCount: 3, passCount: 0, replyCount: 0, lastActivityAt: recent },
      now
    );
    const voiceHeavy = conferenceHotScore(
      { hypeCount: 0, passCount: 0, replyCount: 30, lastActivityAt: recent },
      now
    );
    expect(hypeLed).toBeGreaterThan(voiceHeavy);

    const freshHeat = conferenceHotScore(
      { hypeCount: 4, passCount: 0, replyCount: 4, lastActivityAt: recent },
      now
    );
    const eightHoursOld = conferenceHotScore(
      { hypeCount: 4, passCount: 0, replyCount: 4, lastActivityAt: "2026-10-02T04:00:00Z" },
      now
    );
    expect(eightHoursOld).toBeCloseTo(freshHeat / 2, 6);
  });

  it("collapses a Voice at net -5 without deleting the conversation", () => {
    expect(isConferenceVoiceCollapsed({ hypeCount: 2, passCount: 6 })).toBe(false);
    expect(isConferenceVoiceCollapsed({ hypeCount: 2, passCount: 7 })).toBe(true);
    expect(detail).toContain("Voice hidden by community votes · Show Voice");
  });

  it("can reheat an older Topic after recent positive activity", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const base = { hypeCount: 5, passCount: 0, replyCount: 3 };
    const reheated = conferenceHotScore(
      { ...base, lastActivityAt: "2026-10-02T11:55:00Z" },
      now
    );
    const stale = conferenceHotScore(
      { ...base, lastActivityAt: "2026-10-01T00:00:00Z" },
      now
    );
    expect(reheated).toBeGreaterThan(stale);
  });

  it("keeps Voice replies flat and preserves the per-Topic anonymous identity", () => {
    expect(migration).toContain("reply_to_reply_id");
    expect(server).toContain("replyTo:");
    expect(actions).toContain("replyToReplyId");
    expect(detail).toContain("Replies stay in one flat Voice stream");
    expect(detail).toContain("Replying to");
    expect(detail).not.toContain("children:");
  });

  it("animates Hot entirely on the client with reduced-motion support", () => {
    expect(feed).toContain("styles.hotFlame");
    expect(feed).toContain("lastActivityAt: reheatedAt");
    expect(css).toContain("@keyframes conference-hot-flame");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).not.toContain("fetch(");
  });
});
