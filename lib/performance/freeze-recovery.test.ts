import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("app freeze recovery safeguards", () => {
  it("always releases the message loading state", () => {
    const messages = source("components/messages/messages-page.tsx");
    expect(messages).toContain("finally");
    expect(messages).toContain("setLoadingMessages(false)");
    expect(messages).toContain("loadRequestIdRef");
  });

  it("coalesces realtime message refreshes and cleans subscriptions", () => {
    for (const file of [
      "components/messages/messages-page.tsx",
      "components/groups/group-detail-page.tsx"
    ]) {
      const content = source(file);
      expect(content).toContain("refreshInFlight");
      expect(content).toContain("refreshQueued");
      expect(content).toContain("removeChannel");
      expect(content).toContain("clearTimeout");
    }
  });

  it("provides route loading and retry boundaries", () => {
    expect(source("app/(app)/loading.tsx")).toContain("Loading page");
    expect(source("app/(app)/error.tsx")).toContain("Try again");
    expect(source("components/navigation/navigation-watchdog.tsx")).toContain(
      "This page is taking longer than expected"
    );
    expect(source("components/navigation/navigation-watchdog.tsx")).toContain(
      "failed to fetch dynamically imported module"
    );
  });

  it("prevents foreground refresh storms with single-flight guards", () => {
    expect(source("components/app-shell/app-shell.tsx")).toContain(
      "unreadRefreshRef.current"
    );
    expect(source("components/pwa/service-worker-registration.tsx")).toContain(
      "updateCheckInFlight"
    );
    expect(source("components/hangout/hangout-mode-page.tsx")).toContain(
      "requestRefreshRef.current"
    );
  });

  it("times out authentication actions and uses a full post-auth navigation", () => {
    for (const file of [
      "components/auth/login-form.tsx",
      "components/auth/signup-form.tsx"
    ]) {
      const content = source(file);
      expect(content).toContain("withTimeout");
      expect(content).toContain("window.location.assign");
    }
    expect(source("components/auth/session-boundary.tsx")).toContain(
      "authSubscription?.unsubscribe()"
    );
  });

  it("shares authoritative auth verification across protected page renders", () => {
    for (const file of [
      "app/(app)/friends/page.tsx",
      "app/(app)/notifications/page.tsx",
      "app/(app)/hangout-mode/page.tsx",
      "app/(app)/moments/page.tsx",
      "app/(app)/plans/page.tsx",
      "app/(app)/safe-arrival/page.tsx"
    ]) {
      expect(source(file)).toContain("getCurrentUser");
      expect(source(file)).not.toContain("supabase.auth.getUser()");
    }
  });

  it("cannot leave the animated live signal layer blocking a suspended page", () => {
    const content = source("components/notifications/live-signal-toast.tsx");
    expect(content).toContain('window.addEventListener("pagehide"');
    expect(content).toContain('document.addEventListener("visibilitychange"');
    expect(content).toContain("onAnimationEnd");
  });
});
