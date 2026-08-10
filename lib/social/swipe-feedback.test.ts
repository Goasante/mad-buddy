import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const deck = stripComments(read("components/socialize/swipe-deck.tsx"));
const page = stripComments(read("components/socialize/socialize-page.tsx"));
const shell = stripComments(read("components/app-shell/app-shell.tsx"));
const friendsPage = stripComments(read("components/friends/friends-page.tsx"));
const hook = stripComments(read("hooks/use-incoming-request-count.ts"));
const route = stripComments(read("app/api/friends/request-count/route.ts"));
const css = read("app/globals.css");

// ---------------------------------------------------------------------------
// The card leaves after a wave
// ---------------------------------------------------------------------------

describe("waving removes the card, as passing does", () => {
  it("takes the person out of the deck", () => {
    // The card used to animate away and come straight back: the request was
    // sent, but the deck said otherwise, so the obvious next move was to
    // swipe the same person again.
    const wave = page.slice(page.indexOf("function wave(person"));
    expect(wave.slice(0, 900)).toContain("removeFromDeck(current, person.userId)");
  });

  it("no longer merely marks them as waved", () => {
    const wave = page.slice(page.indexOf("function wave(person"), page.indexOf("function passPerson"));
    expect(wave).not.toContain('waveState: "sent" } : item');
  });

  it("restores the card when the request fails", () => {
    // A card that stayed gone after a failed write would look like success
    // while the person reappeared on the next refresh.
    const wave = page.slice(page.indexOf("function wave(person"), page.indexOf("function passPerson"));
    expect(wave).toContain("restoreToDeck(current,");
    expect(wave).toContain('waveState: "none"');
  });

  it("does not restore a person who already sent YOU a request as swipeable", () => {
    // THE LOOP THIS CLOSES. sendFriendRequest refuses when a request exists in
    // the other direction, and that failure was restoring the person with
    // waveState "none" -- so deckCandidates let them straight back into the
    // deck, to be swiped and refused identically, forever.
    const wave = page.slice(page.indexOf("function wave(person"), page.indexOf("function passPerson"));
    expect(wave).toContain('result.reason === "incoming_request_exists"');
    expect(wave).toContain('waveState: "received"');
  });

  it("branches on a stable code, never on the message text", () => {
    // A copy edit must not be able to change behaviour.
    const wave = page.slice(page.indexOf("function wave(person"), page.indexOf("function passPerson"));
    expect(wave).not.toContain("message.includes");

    // And the service actually sends that code alongside the sentence.
    const service = stripComments(read("lib/friends/service.ts"));
    const incoming = service.slice(service.indexOf("already sent you a request"));
    expect(incoming.slice(0, 200)).toContain('reason: "incoming_request_exists"');
  });

  it("still offers a retry for failures that leave no request behind", () => {
    // A network error or a rate limit is worth another attempt; those restore
    // as "none" exactly as before.
    const wave = page.slice(page.indexOf("function wave(person"), page.indexOf("function passPerson"));
    expect(wave).toContain('waveState: "none"');
  });

  it("uses the shared deck helpers rather than its own filter", () => {
    // Filtering by id is what stops a concurrent refresh removing the wrong
    // person; both decisions go through the same helper.
    expect(page).toContain('from "@/lib/social/swipe-deck"');
  });
});

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

describe("a swipe is felt as well as seen", () => {
  it("fires when the decision is made, not when the animation ends", () => {
    // The tick belongs under the thumb that made the choice.
    const commit = deck.slice(deck.indexOf("const commit = useCallback"));
    const hapticAt = commit.indexOf("haptic(");
    const exitAt = commit.indexOf("setExiting({");
    expect(hapticAt).toBeGreaterThan(-1);
    expect(hapticAt).toBeLessThan(exitAt);
  });

  it("gives waving the firmer pattern", () => {
    // Waving is the affirmative choice; passing is a dismissal.
    expect(deck).toContain('haptic(decision === "wave" ? "select" : "tick")');
  });

  it("goes through the shared abstraction, never raw vibration", () => {
    expect(deck).toContain('from "@/lib/device/haptics"');
    expect(deck).not.toContain("navigator.vibrate");
  });

  it("covers the buttons as well as the gesture", () => {
    // Both routes call commit, so the tick is identical either way.
    expect(deck).toContain('commit(top, "wave")');
    expect(deck).toContain('commit(top, "pass")');
  });
});

// ---------------------------------------------------------------------------
// The swipe hint
// ---------------------------------------------------------------------------

describe("the deck says it can be swiped", () => {
  it("shows a hint on arrival", () => {
    expect(deck).toContain("useState(true)");
    expect(deck).toContain("linkr-swipe-hint");
  });

  it("names both directions", () => {
    expect(deck).toContain("Pass");
    expect(deck).toContain("Wave");
  });

  it("disappears as soon as the deck is touched", () => {
    // Somebody already swiping does not need to be told to swipe.
    const down = deck.slice(deck.indexOf("function handlePointerDown"));
    expect(down.slice(0, 300)).toContain("setShowSwipeHint(false)");
  });

  it("retires on its own for someone who only reads", () => {
    expect(deck).toContain("setShowSwipeHint(false), 4200");
  });

  it("hides during a drag or an exit", () => {
    expect(deck).toContain("showSwipeHint && activeDrag.dx === 0 && !exiting");
  });

  it("is decorative, so it is not announced twice", () => {
    // The deck carries a real role and label, and the buttons state both
    // actions in words.
    const hint = deck.slice(deck.indexOf("linkr-swipe-hint"));
    expect(hint.slice(0, 200)).toContain('aria-hidden="true"');
  });

  it("stops moving under reduced motion but keeps saying what to do", () => {
    const reduced = css.slice(css.indexOf(".linkr-swipe-hint,"));
    expect(css).toContain("@keyframes linkr-hint-tilt");
    expect(reduced.slice(0, 400)).toContain("animation: none");
  });
});

// ---------------------------------------------------------------------------
// The Muddies request badge
// ---------------------------------------------------------------------------

describe("pending Muddy requests show on the Muddies tab", () => {
  it("counts incoming requests only", () => {
    // Requests the user SENT are not pending anything on their side, and a
    // badge nobody can clear is worse than none.
    expect(route).toContain("countIncomingRequests(auth.user.id)");
    expect(route).toContain("requestCount");
  });

  it("reuses the count behind the existing Add Muddy control", () => {
    // The badge and the queue can never disagree about what is waiting.
    expect(route).toContain('from "@/lib/friends/service"');
  });

  it("renders on both the sidebar and the mobile tab", () => {
    expect(shell).toContain('item.href === "/friends" ? <UnreadBadge count={muddyRequestCount} /> : null');
    expect(shell).toContain('tab.href === "/friends" && muddyRequestCount > 0');
  });

  it("shares the badge component with Messages, so the two match", () => {
    // Two badges that format differently is a thing users notice without
    // being able to say why.
    expect(shell).toContain("<UnreadBadge count={messageUnreadCount} />");
    expect(shell).toContain("<UnreadBadge count={muddyRequestCount} />");
  });

  it("announces the count to screen readers", () => {
    expect(shell).toContain("notificationAriaLabel(item.label, muddyRequestCount)");
  });

  it("clears the moment a request is accepted or declined", () => {
    // Every accept, decline, cancel and block funnels through runFriendAction.
    const runner = friendsPage.slice(friendsPage.indexOf("function runFriendAction"));
    expect(runner.slice(0, 600)).toContain("announceMuddyRequestsUpdated()");
  });

  it("polls like the messages badge rather than inventing a cadence", () => {
    expect(hook).toContain("30_000");
    expect(hook).toContain("if (!document.hidden)");
  });

  it("keeps the last count through a network failure", () => {
    // Dropping to zero would clear a badge for requests still waiting.
    const catchBlock = hook.slice(hook.indexOf("} catch {"));
    expect(catchBlock.slice(0, 200)).not.toContain("setRequestCount(0)");
  });

  it("never runs two reads at once", () => {
    // Focus, visibility and the interval can all fire together on wake.
    expect(hook).toContain("if (inFlight.current) return inFlight.current");
  });

  it("is never cached", () => {
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("requires authentication", () => {
    expect(route).toContain("resolveApiUser(request)");
    expect(route).toContain('{ status: 401 }');
  });
});
