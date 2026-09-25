import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("friend actions acknowledge a tap before the network finishes", () => {
  const page = source("components/friends/friends-page.tsx");
  const cards = source("components/friends/muddies-requests.tsx");
  const button = source("components/ui/button.tsx");

  it("search shows progress and ignores stale results after a query or modal change", () => {
    expect(page).toContain('searchPendingRef.current = true');
    expect(page).toContain('requestId !== searchRequestIdRef.current');
    expect(page).toContain('++searchRequestIdRef.current');
    expect(page).toContain('searchPending ? "Searching…" : "Search"');
    expect(page).toContain('aria-busy={searchPending}');
  });

  it("accept is guarded by person and reflects pending state in both request lists", () => {
    expect(page).toContain('pendingFriendIdsRef.current.has(userId)');
    expect(page).toContain('person.id, "Accepting…"');
    expect(page).toContain('user.id, "Accepting…"');
    expect(page).toContain('pendingActions={pendingFriendActions}');
    expect(page).toContain('pendingAction={pendingFriendActions[user.id]}');
    expect(cards).toContain('disabled={busy}');
    expect(cards).toContain('pendingAction === "Accepting…"');
  });

  it("provides visible press feedback even on touch devices without haptics", () => {
    expect(button).toContain('active:scale-[0.98]');
    expect(button).toContain('motion-reduce:active:scale-100');
    expect(cards).toContain('active:scale-[0.98]');
  });

  it("dismisses the request confirmation instead of leaving it over the page", () => {
    expect(page).toContain('if (!feedback) return;');
    expect(page).toContain('window.setTimeout(() => setFeedback(""), 3500)');
    expect(page).toContain('window.clearTimeout(timeout)');
  });

  it("dismisses short-lived confirmations on Muddy profiles too", () => {
    const profile = source("components/friends/muddy-profile-page.tsx");
    const nextProfile = source("components/friends/muddy-profile-vnext.tsx");
    const sheet = source("components/glow/muddy-profile-modal.tsx");
    expect(profile).toContain('window.setTimeout(() => setWaveFeedback(""), 3500)');
    expect(profile).toContain('window.setTimeout(() => setGlowFeedback(""), 5000)');
    expect(nextProfile).toContain('window.setTimeout(() => setFeedback(""), 3500)');
    expect(sheet).toContain('window.setTimeout(() => setWaveFeedback(""), 3500)');
    for (const component of [profile, nextProfile, sheet]) {
      expect(component).toContain('window.clearTimeout(timeout)');
    }
  });
});

describe("a committed friendship is not held hostage by optional followups", () => {
  const service = source("lib/friends/service.ts");
  const accept = service.slice(service.indexOf("export async function acceptFriendRequest("), service.indexOf("/** Decline (as receiver)"));

  it("schedules milestones, event and notification after the response", () => {
    expect(accept.indexOf('rlsClient.rpc("accept_friend_request"')).toBeLessThan(accept.indexOf("after(async () =>"));
    expect(accept).toContain("Promise.allSettled([");
    expect(accept).toContain("deliverNotification(admin,");
    expect(accept).toContain('return { ok: true, message: "Muddy request accepted." }');
  });
});

describe("chat opens show which Muddy was tapped", () => {
  const inbox = source("components/messages/messages-page-v4.tsx");
  const shortcuts = source("components/messages/messages-shortcuts.tsx");

  it("guards duplicate taps and shows progress on the selected person", () => {
    expect(inbox).toContain("if (newChatPendingRef.current) return;");
    expect(inbox).toContain("setNewChatPendingFriendId(friendId);");
    expect(inbox).toContain("newChatPendingRef.current = false;");
    expect(shortcuts).toContain('pendingFriendId === friend.friendId ? <span');
    expect(shortcuts).toContain('aria-busy={pendingFriendId === friend.friendId}');
  });
});
