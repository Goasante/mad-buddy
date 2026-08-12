import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const shared = read("components/ui/long-press-actions.tsx");
const messagesPage = read("components/messages/messages-page.tsx");
const groupDetail = read("components/groups/group-detail-page.tsx");
const messageMenu = read("components/messaging/message-actions-menu.tsx");
const muddiesGrid = read("components/friends/muddies-grid.tsx");

/**
 * One contextual-action system across the app.
 *
 * These assert the SHARED ARCHITECTURE rather than re-testing gesture
 * mechanics: the timing, movement tolerance and cancellation are proven
 * behaviourally in lib/friends/long-press.test.ts against the hook itself.
 * What matters here is that no surface reimplements them.
 */

describe("every contextual surface uses the one hook", () => {
  const surfaces = {
    "shared wrapper": shared,
    "message menu": messageMenu,
    "muddies grid": muddiesGrid
  };

  it("never reimplements the hold timer", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      expect(source, name).toContain('from "@/hooks/use-long-press"');
      // A local setTimeout here is a second, drifting implementation.
      expect(source, name).not.toContain("setTimeout");
    }
  });

  it("never reaches the vibration API directly", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      expect(source, name).not.toContain("navigator.vibrate");
    }
  });

  it("routes menus through the one menu component", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      expect(source, name).toContain("AppMenu");
    }
  });
});

describe("the shared wrapper honours the interaction contract", () => {
  it("cancels on movement, leave and pointer cancel", () => {
    // Any missing handler is how a hold survives a scroll.
    for (const handler of ["onPointerMove", "onPointerLeave", "onPointerCancel"]) {
      expect(shared, handler).toContain(`${handler}={handlers.${handler}}`);
    }
  });

  it("suppresses the click that follows a fired hold", () => {
    // Without this, holding a conversation row also opens it.
    expect(shared).toContain("onClick={handlers.onClick}");
  });

  it("gives desktop the same menu via right-click", () => {
    expect(shared).toContain("onContextMenu={handlers.onContextMenu}");
  });

  it("adds no gesture when there is nothing to offer", () => {
    expect(shared).toContain("if (!hasActions) return <>{children}</>;");
  });

  it("acknowledges a successful hold with a haptic", () => {
    expect(shared).toContain('haptic("tick")');
  });
});

describe("wired surfaces expose only real, authorized actions", () => {
  it("conversation rows offer mute and pin, which both exist", () => {
    const row = messagesPage.slice(messagesPage.indexOf("Actions for ${conversation.title}"));
    expect(row.slice(0, 700)).toContain("toggleMute(conversation)");
    expect(row.slice(0, 700)).toContain("togglePin(conversation.id, !conversation.pinned)");
  });

  it("conversation rows keep their tap action", () => {
    // The hold is a shortcut; tapping still opens the conversation.
    expect(messagesPage).toContain("onClick={() => openConversation(conversation.id)}");
  });

  it("Circle members reuse the already-authorized action list", () => {
    // memberActions() decides permission; the menu never widens it.
    expect(groupDetail).toContain("const menuItems = actions.map((action) => ({");
    expect(groupDetail).toContain("items={menuItems}");
  });

  it("Circle members keep their visible More button", () => {
    // Long-press must never be the only route to member management.
    expect(groupDetail).toContain('aria-label={`Actions for ${member.displayName}`}');
    expect(groupDetail).toContain("MoreHorizontal");
  });

  it("no surface ships a placeholder action", () => {
    for (const [name, source] of Object.entries({ messagesPage, groupDetail, messageMenu })) {
      expect(source, name).not.toContain("Coming soon");
      expect(source, name).not.toContain("not yet available");
    }
  });
});
