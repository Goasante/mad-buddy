import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const experience = read("components/messages/messages-experience-v5.tsx");
const shell = read("components/app-shell/app-shell.tsx");

describe("Messages V5 follow-up polish", () => {
  it("keeps the mobile top row to Messages, notifications and profile, with New Chat beside Search", () => {
    const top = experience.slice(
      experience.indexOf('aria-label="Messages shortcuts"'),
      experience.indexOf('<div data-v4-host')
    );
    const host = experience.slice(
      experience.indexOf('<div data-v4-host'),
      experience.indexOf('<ManageFavoritesModal')
    );

    expect(top).toContain('href="/notifications"');
    expect(top).toContain('href="/profile"');
    expect(top).not.toContain('aria-label="New chat"');
    expect(host).toContain("data-v5-new-chat-trigger");
    expect(host).toContain('aria-label="New chat"');
    expect(experience).toContain("margin-right: 3.25rem");
    expect(experience).toContain("top: 1.05rem");
  });

  it("opens New Chat without forcing the keyboard and keeps the focused sheet below the notch", () => {
    const modal = experience.slice(
      experience.indexOf("function NewChatModal"),
      experience.indexOf("function SearchField")
    );

    expect(modal).toContain('owner="messages-new-chat"');
    expect(modal).not.toContain("autoFocus");
    expect(modal).toContain("data-new-chat-results");
    expect(experience).toContain('[data-modal-owner="messages-new-chat"]');
    expect(experience).toContain("100dvh");
    expect(experience).toContain("env(safe-area-inset-top, 0px)");
    expect(experience).toContain(":focus-within [data-new-chat-results]");
  });

  it("keeps a live numeric unread-message badge on the global Messages nav icon", () => {
    expect(shell).toContain("useUnreadMessageCount(currentUserId)");
    expect(shell).toContain('tab.href === "/messages" ? messageUnreadCount : 0');
    expect(shell).toContain('tab.href === "/messages" && messageUnreadCount > 0 ? <UnreadBadge count={messageUnreadCount} /> : null');
    expect(shell).toContain('{count > 99 ? "99+" : count}');
  });
});
