import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261002155500_conference_realtime_signals.sql");
const hook = read("hooks/use-conference-realtime.ts");
const api = read("app/api/conference/live/route.ts");
const feed = read("components/conference/conference-page.tsx");
const detail = read("components/conference/conference-topic-page.tsx");

describe("Conference realtime delivery", () => {
  it("broadcasts invalidation only, never Conference content or location", () => {
    expect(migration).toContain("realtime.send");
    expect(migration).toContain('{"kind":"changed"}');
    expect(migration).not.toContain("origin_latitude");
    expect(migration).not.toContain("origin_longitude");
    expect(migration).not.toContain("NEW.body");
    expect(migration).not.toContain("OLD.body");
  });

  it("uses authenticated private Broadcast channels without granting client writes", () => {
    expect(migration).toContain('for select\nto authenticated');
    expect(migration).toContain("(select realtime.topic()) = 'conference:feed'");
    expect(migration).toContain("conference:topic:");
    expect(migration).not.toContain("for insert\nto authenticated");

    expect(hook).toContain('config: { private: true }');
    expect(hook).toContain('.on("broadcast", { event: "changed" }');
    expect(hook).toContain("authenticateRealtime");
    expect(hook).not.toContain("postgres_changes");
  });

  it("coalesces realtime events and keeps a bounded fallback", () => {
    expect(hook).toContain("SIGNAL_DEBOUNCE_MS = 140");
    expect(hook).toContain("OFFLINE_FALLBACK_MS = 8_000");
    expect(hook).toContain("CONNECTED_SAFETY_REFRESH_MS = 45_000");
    expect(hook).toContain("if (disposed || queued) return");
    const queue = hook.slice(hook.indexOf("const queueRefresh"), hook.indexOf("const channelName"));
    expect(queue).toContain('document.visibilityState !== "visible"');
    expect(queue.indexOf('document.visibilityState !== "visible"')).toBeLessThan(queue.indexOf("queued = true"));
    expect(queue.slice(queue.indexOf("window.setTimeout"))).toContain('document.visibilityState !== "visible"');
  });

  it("re-reads canonical server-filtered Conference data", () => {
    expect(api).toContain("loadConferenceFeed(auth.user.id)");
    expect(api).toContain("loadConferenceTopic(auth.user.id, parsed.data)");
    expect(api).toContain('"Cache-Control": "no-store"');
    expect(feed).toContain('fetch("/api/conference/live"');
    expect(detail).toContain("/api/conference/live?topicId=");
  });

  it("preserves local optimistic UI while other users update in realtime", () => {
    expect(feed).toContain("mergeLiveTopics");
    expect(feed).toContain("useConferenceRealtime");
    expect(detail).toContain("mergeLiveReplies");
    expect(detail).toContain("useConferenceRealtime");
    expect(detail).toContain("setReplies((current) => mergeLiveReplies");
  });
});
