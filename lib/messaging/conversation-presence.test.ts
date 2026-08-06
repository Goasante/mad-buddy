import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conversationContext,
  dayLabel,
  startsNewDay,
  startsNewRun,
  RUN_GAP_MS
} from "@/lib/messaging/conversation-presence";
import { stripComments } from "@/lib/content/strip-comments";
import type { ConversationView } from "@/lib/messaging/mobile";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("components/messages/messages-page.tsx");
const css = read("app/globals.css");
const canvasCss = css.slice(
  css.indexOf("/* Conversation canvas"),
  // Bounded: the Mad Buddy Orb's rules follow this block, and its colours and
  // transforms are not this section's to police.
  css.indexOf("/* Mad Buddy Orb")
);

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN = 60_000;

function conversation(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "c1",
    title: "Okoro",
    avatarUrl: null,
    otherUsername: null,
    kind: "direct",
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    muted: false,
    pinned: false,
    contextBadge: null,
    otherPlan: null,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Mad Buddy context
// ---------------------------------------------------------------------------

describe("conversation context", () => {
  it("leads with the shared thing that created the conversation", () => {
    expect(conversationContext(conversation({ contextBadge: "Plan" }))).toEqual({
      subtitle: "From a shared plan",
      shared: true
    });
    expect(conversationContext(conversation({ contextBadge: "Event" })).subtitle).toBe("From an event");
    expect(conversationContext(conversation({ contextBadge: "Safe Arrival" })).subtitle).toBe(
      "Safe Arrival check-in"
    );
  });

  it("prefers shared context over the handle", () => {
    const result = conversationContext(conversation({ contextBadge: "Plan", otherUsername: "okoro" }));
    expect(result.subtitle).toBe("From a shared plan");
    expect(result.shared).toBe(true);
  });

  it("falls back to the handle", () => {
    expect(conversationContext(conversation({ otherUsername: "okoro" }))).toEqual({
      subtitle: "@okoro",
      shared: false
    });
  });

  it("names a group rather than pretending it is a person", () => {
    expect(conversationContext(conversation({ kind: "group" })).subtitle).toBe("Group conversation");
  });

  it("says nothing when there is nothing true to say", () => {
    // A shorter header is correct; a fabricated one is not.
    expect(conversationContext(conversation()).subtitle).toBeNull();
  });

  it("never invents proximity, availability or a relationship", () => {
    // The ConversationView carries no distance and no presence, so the header
    // must not imply either. This is the guard against "2 km away · Active now"
    // appearing as decoration.
    const source = stripComments(read("lib/messaging/conversation-presence.ts"));
    for (const banned of ["km", "miles", "Active now", "Online", "Nearby", "last seen", "Math.random"]) {
      expect(source, `must not fabricate ${banned}`).not.toContain(banned);
    }
    for (const banned of ["Active now", "Online now", "km away"]) {
      expect(stripComments(page), `header must not claim ${banned}`).not.toContain(banned);
    }
  });

  it("reads only fields the server already sent", () => {
    const source = stripComments(read("lib/messaging/conversation-presence.ts"));
    for (const banned of ["createSupabase", "fetch(", "from("]) {
      expect(source).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Runs and dividers
// ---------------------------------------------------------------------------

describe("message runs", () => {
  const mine = (minutesAgo: number) => ({ isMine: true, createdAt: new Date(NOW - minutesAgo * MIN).toISOString() });
  const theirs = (minutesAgo: number) => ({
    isMine: false,
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString()
  });

  it("starts a run for the first message", () => {
    expect(startsNewRun(mine(0), undefined)).toBe(true);
  });

  it("starts a run when the speaker changes", () => {
    expect(startsNewRun(theirs(4), mine(5))).toBe(true);
  });

  it("continues a run for the same speaker in quick succession", () => {
    expect(startsNewRun(mine(4), mine(5))).toBe(false);
  });

  it("breaks a run after a long pause", () => {
    // Same speaker, but far enough apart that it reads as a new thought.
    const gapMinutes = RUN_GAP_MS / MIN + 1;
    expect(startsNewRun(mine(0), mine(gapMinutes))).toBe(true);
  });

  it("merges nothing — grouping is purely visual", () => {
    const source = stripComments(read("lib/messaging/conversation-presence.ts"));
    for (const banned of [".filter(", ".slice(", ".concat("]) {
      expect(source, `runs must not drop messages via ${banned}`).not.toContain(banned);
    }
  });
});

describe("day dividers", () => {
  it("shows a divider above the first message", () => {
    expect(startsNewDay(new Date(NOW).toISOString(), undefined)).toBe(true);
  });

  it("shows one when the day changes", () => {
    expect(startsNewDay(new Date(NOW).toISOString(), new Date(NOW - 24 * 60 * MIN).toISOString())).toBe(true);
  });

  it("does not repeat within one day", () => {
    expect(startsNewDay(new Date(NOW).toISOString(), new Date(NOW - 30 * MIN).toISOString())).toBe(false);
  });

  it("labels today and yesterday in words", () => {
    expect(dayLabel(new Date(NOW).toISOString(), NOW)).toBe("Today");
    expect(dayLabel(new Date(NOW - 24 * 60 * MIN).toISOString(), NOW)).toBe("Yesterday");
  });

  it("falls back to a short date further back", () => {
    const label = dayLabel(new Date(NOW - 10 * 24 * 60 * MIN).toISOString(), NOW);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The conversation owns the screen
// ---------------------------------------------------------------------------

describe("conversation screen", () => {
  it("fills the screen on mobile instead of sitting in a card", () => {
    expect(page).toContain("conversation-canvas fixed inset-0 z-30 h-[100dvh] lg:static");
  });

  it("keeps the desktop two-pane panel", () => {
    // The redesign is mobile-first; the desktop layout still needs its panel.
    expect(page).toContain("lg:rounded-2xl lg:border lg:border-border/70");
  });

  it("drops the heavy rules that made it feel contained", () => {
    const header = page.slice(page.indexOf("MESSAGES_CHAT_HEADER"), page.indexOf("MESSAGES_QUICK_REPLIES"));
    expect(header).not.toContain("border-b border-border/70");
    const composer = page.slice(page.indexOf("MESSAGES_COMPOSER"));
    expect(composer).not.toContain("border-t");
  });

  it("respects the safe area at both ends", () => {
    expect(page).toContain("pt-[max(0.5rem,env(safe-area-inset-top))]");
    expect(page).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
  });
});

describe("composer", () => {
  const composer = page.slice(page.indexOf("MESSAGES_COMPOSER"));

  it("is one soft pill rather than a field plus a button", () => {
    expect(composer).toContain("rounded-full bg-secondary/70");
    expect(composer).toContain("focus-within:bg-secondary");
  });

  it("keeps send quiet until there is something to send", () => {
    expect(composer).toContain("draft.trim() && !isPending");
    expect(composer).toContain("scale-90 bg-transparent");
  });

  it("still labels the send action for assistive tech", () => {
    expect(composer).toContain('aria-label="Send message"');
    expect(composer).toContain('aria-label={`Message ${selected.title}`}');
  });
});

describe("thread", () => {
  it("uses soft, generous bubble corners", () => {
    expect(page).toContain('"rounded-[1.25rem]"');
  });

  it("breathes between speakers and tightens within a run", () => {
    expect(page).toContain('startsNewRun(message, messages[messageIndex - 1]) ? "mt-3 first:mt-0" : "mt-0.5"');
  });

  it("shows one timestamp per run, not one per message", () => {
    const thread = page.slice(page.indexOf("MESSAGES_CHAT_HEADER"), page.indexOf("MESSAGES_QUICK_REPLIES"));
    expect(thread).toContain("formatRelativeTime(message.createdAt)");
    expect(thread).toContain("startsNewRun(messages[messageIndex + 1]");
  });

  it("gives the empty state whitespace rather than a box", () => {
    const empty = page.slice(page.indexOf("messages.length === 0"), page.indexOf("messages.map("));
    expect(empty).toContain("GlowAvatar");
    expect(empty).not.toContain("border");
    expect(empty).not.toContain("bg-card");
  });
});

// ---------------------------------------------------------------------------
// Branded ground
// ---------------------------------------------------------------------------

describe("branded canvas", () => {
  it("uses restrained brand washes, not a pattern or an image", () => {
    expect(canvasCss).toContain("radial-gradient(");
    expect(canvasCss).toContain("--color-brand-orange");
    for (const banned of ["url(", ".png", ".svg", "repeating-"]) {
      expect(canvasCss, `must not use ${banned}`).not.toContain(banned);
    }
  });

  it("keeps every wash faint enough for text to stay legible", () => {
    const mixes = [...canvasCss.matchAll(/brand-orange\)\s*(\d+)%/g)].map((match) => Number(match[1]));
    expect(mixes.length).toBeGreaterThan(0);
    for (const value of mixes) expect(value).toBeLessThanOrEqual(10);
  });

  it("is designed for both themes", () => {
    expect(canvasCss).toContain('data-theme="dark"');
    expect(canvasCss).toContain("prefers-color-scheme: dark");
  });

  it("settles messages in without bouncing", () => {
    expect(canvasCss).toContain("@keyframes conversation-message-in");
    expect(canvasCss).toContain("translateY(6px)");
    // Comments stripped: the comment stating "no bounce, no scale" names the
    // very words it forbids.
    const rules = stripComments(canvasCss);
    for (const banned of ["scale(", "bounce", "spring"]) {
      expect(rules, `motion must stay calm (${banned})`).not.toContain(banned);
    }
  });

  it("respects reduced motion", () => {
    const reduced = canvasCss.slice(canvasCss.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
  });
});

// ---------------------------------------------------------------------------
// Conversation Mode: the bottom navigation steps aside
// ---------------------------------------------------------------------------

describe("Conversation Mode", () => {
  const shell = read("components/app-shell/app-shell.tsx");
  const immersive = read("components/app-shell/immersive-mode.tsx");

  it("turns on exactly while a conversation is open", () => {
    expect(page).toContain("useImmersiveWhile(Boolean(selectedId))");
  });

  it("clears itself on unmount, so Back always restores the bar", () => {
    // A screen must not be able to strand the user without navigation by
    // forgetting to switch the flag off.
    expect(immersive).toContain("return () => setImmersive(false);");
  });

  it("hides the bottom navigation rather than merely fading it", () => {
    const nav = shell.slice(shell.indexOf("function MobileNav("), shell.indexOf("function MobileNavTab"));
    expect(nav).toContain("translate-y-full opacity-0");
    expect(nav).toContain("pointer-events-none");
    // Off-screen chrome must leave the tab order and the accessibility tree.
    expect(nav).toContain("aria-hidden={immersive || undefined}");
    expect(nav).toContain("inert={immersive || undefined}");
  });

  it("reclaims the navigation height instead of leaving a dead strip", () => {
    // Asserted as single tokens: the source wraps these across lines, and the
    // file's line endings are not this test's business.
    expect(shell).toContain('? "pb-0"');
    expect(shell).toContain('"pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]"');
  });

  it("slides rather than jumping, and respects reduced motion", () => {
    const nav = shell.slice(shell.indexOf("function MobileNav("), shell.indexOf("function MobileNavTab"));
    expect(nav).toContain("transition-[transform,opacity] duration-300 ease-out");
    expect(nav).toContain("motion-reduce:transition-none");
  });

  it("uses one shared flag rather than a second navigation system", () => {
    // Whether a conversation is open lives in the page's own state, not the
    // URL, so the shell cannot derive it from the pathname.
    expect(immersive).toContain("createContext");
    expect(stripComments(shell)).not.toContain('pathname === "/messages"');
  });

  it("is safe to read outside the provider", () => {
    expect(immersive).toContain("?? { immersive: false, setImmersive: () => {} }");
  });

  it("anchors the composer to the safe area as the bottom-most element", () => {
    const composer = page.slice(page.indexOf("MESSAGES_COMPOSER"));
    expect(composer).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    // The conversation fills the viewport, so nothing sits below the composer.
    expect(page).toContain("h-[100dvh]");
  });

  it("leaves the inbox with its navigation", () => {
    // Only the open-conversation case is immersive.
    expect(page).not.toContain("useImmersiveWhile(true)");
  });
});

// ---------------------------------------------------------------------------
// The header opens the profile
// ---------------------------------------------------------------------------

describe("conversation identity links to the profile", () => {
  const identity = page.slice(page.indexOf("function ConversationIdentity"), page.indexOf("function PinPickerModal"));

  it("opens the existing profile route rather than a new destination", () => {
    expect(identity).toContain("`/friends/${conversation.otherUsername}`");
  });

  it("makes the avatar and the name one target", () => {
    // Both sit inside the same link, so tapping either opens the profile.
    expect(identity).toContain("<GlowAvatar");
    expect(identity).toContain("{conversation.title}");
    expect(identity).toContain("<Link");
  });

  it("stays plain text when there is no profile to open", () => {
    // A group has no single person behind it.
    expect(identity).toContain("if (!conversation.otherUsername) {");
    expect(identity).toContain("<span className=\"flex min-w-0 flex-1 items-center gap-2.5\">{body}</span>");
  });

  it("announces where it goes", () => {
    expect(identity).toContain("aria-label={`View ${conversation.title}'s profile`}");
  });

  it("renders the same markup either way", () => {
    // One `body`, used by both branches, so the linked and unlinked headers
    // cannot drift apart.
    expect(identity).toContain("const body = (");
    expect((identity.match(/\{body\}/g) ?? []).length).toBe(2);
  });
});
