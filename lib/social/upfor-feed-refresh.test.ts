import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEED_REFRESH_INTERVAL_MS } from "@/hooks/use-feed-refresh";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const hook = read("hooks/use-feed-refresh.ts");
const page = read("components/hangout/hangout-mode-page.tsx");

/**
 * C2 Defect 2. Every eligibility rule was correct and a reload proved the row
 * was visible; the feed was simply never re-read after mount, so a viewer who
 * already had the screen open never saw a friend's new UpFor.
 */
describe("the viewer feed refreshes while someone is looking at it", () => {
  it("polls slower than the countdown, because this read is expensive", () => {
    // getVisibleHangoutsAction resolves friendships, two session queries,
    // per-row eligibility, profiles, requests and plans.
    expect(FEED_REFRESH_INTERVAL_MS).toBe(30_000);
  });

  it("refreshes on every way a person comes back", () => {
    for (const event of ["visibilitychange", "pageshow", "focus", "online"]) {
      expect(hook, event).toContain(`"${event}"`);
    }
  });

  it("does no work in a hidden tab", () => {
    // Both halves: the interval is stopped, and a trigger that fires anyway
    // returns early rather than reading.
    expect(hook).toContain("stopTimer()");
    expect(hook).toContain('document.visibilityState === "hidden"');
  });

  it("removes every listener and the timer on unmount", () => {
    for (const event of ["visibilitychange", "pageshow", "focus", "online"]) {
      expect(hook, event).toContain(`removeEventListener("${event}"`);
    }
    expect(hook).toContain("cancelled = true");
  });
});

describe("a burst of lifecycle events makes one request, not four", () => {
  it("guards on an in-flight refresh", () => {
    // A tab return fires visibilitychange, pageshow and focus within
    // milliseconds of each other.
    expect(hook).toContain("inFlight");
    expect(hook).toContain("if (cancelled || inFlight.current) return;");
  });

  it("always clears the guard, including when the read throws", () => {
    // A guard that leaks on failure would freeze the feed permanently -- a
    // worse defect than the one being fixed.
    expect(hook).toContain(".finally(");
  });
});

describe("a slow earlier response cannot overwrite a newer one", () => {
  it("stamps each read and lets only the newest write", () => {
    expect(page).toContain("const seq = ++feedRequestSeq.current;");
    expect(page).toContain("if (seq !== feedRequestSeq.current) return;");
  });

  it("guards the error path too, not only the success path", () => {
    // An overtaken failure must not raise an error over good fresh data.
    const body = page.slice(page.indexOf("async function refreshFeed"));
    const guarded = body.slice(0, body.indexOf("useFeedRefresh"));
    expect((guarded.match(/seq !== feedRequestSeq\.current/g) ?? []).length).toBe(2);
  });

  it("lets only the newest request own the spinner", () => {
    expect(page).toContain("if (seq === feedRequestSeq.current) setFeedRefreshing(false);");
  });
});

describe("one freshness seam serves every mode", () => {
  it("is wired once on the page", () => {
    expect((page.match(/useFeedRefresh\(/g) ?? []).length).toBe(1);
  });

  it("keeps the manual retry", () => {
    expect(page).toContain("onRetry={() => void refreshFeed()}");
  });

  it("adds no realtime subscription in this defect", () => {
    for (const forbidden of ["supabase.channel", "postgres_changes", "subscribe("]) {
      expect(hook, forbidden).not.toContain(forbidden);
      expect(page, forbidden).not.toContain(forbidden);
    }
  });

  it("leaves the countdown a separate authority", () => {
    // Time presentation and "which UpFors exist for me" are different
    // questions that happen to share some browser events.
    expect(page).toContain("useCountdownResume(setNowMs)");
    expect(hook).not.toContain("setNowMs");
  });
});
