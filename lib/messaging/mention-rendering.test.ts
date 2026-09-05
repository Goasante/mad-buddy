import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitTextWithMentions } from "@/lib/messaging/mentions";
import { tokenizeMessageText } from "@/lib/messaging/linkify";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * BETA-013. Mentions were structured all the way to the renderer, then dropped.
 *
 * `SafeMessageText` declared a `mentions` prop, every V4 bubble passed it, and
 * the implementation destructured only `text`. So the identity the sender
 * picked, the server authorised and the database stored arrived at the last
 * step and was discarded: "@Ama" reached the reader as grey prose with nothing
 * to tap.
 *
 * The fix composes two passes that already existed rather than inventing a
 * matcher: `tokenizeMessageText` reserves the URL spans, and
 * `splitTextWithMentions` cuts on ids the SERVER stored over the text between
 * them. This file tests that composition, because the ORDER of those two passes
 * is the whole safety argument -- and the first draft of the fix had it
 * backwards, which is how the URL case below was caught.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const renderer = stripComments(read("components/messages/safe-message-text.tsx"));

const AMA = "11111111-1111-4111-8111-111111111111";
const AMA_TWO = "22222222-2222-4222-8222-222222222222";

/**
 * The renderer's own pipeline, as a pure function.
 *
 * LINKS FIRST, then mentions over the text between them -- exactly what
 * SafeMessageText does, and the order matters: running mentions first cuts
 * "@Ama" out of the middle of `https://example.com/@Ama/photos` and destroys
 * the URL. Returns a flat description of what the reader ends up with, so the
 * assertions below talk about outcomes rather than JSX.
 */
type Piece =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; userId: string }
  | { kind: "link"; value: string; href: string; internal: boolean };

function render(
  text: string,
  mentions: ReadonlyArray<{ userId: string; displayName: string; username: string | null }>
): Piece[] {
  const pieces: Piece[] = [];
  for (const token of tokenizeMessageText(text)) {
    if (token.kind === "link") {
      pieces.push({ kind: "link", value: token.value, href: token.href, internal: token.internal });
      continue;
    }
    for (const run of splitTextWithMentions(token.value, mentions)) {
      if (run.mentionedUserId) pieces.push({ kind: "mention", value: run.text, userId: run.mentionedUserId });
      else pieces.push({ kind: "text", value: run.text });
    }
  }
  return pieces;
}

const mentionsOf = (pieces: Piece[]) => pieces.filter((piece) => piece.kind === "mention");
const linksOf = (pieces: Piece[]) => pieces.filter((piece) => piece.kind === "link");

// ---------------------------------------------------------------------------
// M1 — a real mention is a distinct thing, not prose
// ---------------------------------------------------------------------------

describe("M1 — a selected member renders as a mention", () => {
  it("separates the mention from the surrounding sentence", () => {
    const pieces = render("are you coming @Ama?", [
      { userId: AMA, displayName: "Ama", username: "ama_s" }
    ]);
    expect(mentionsOf(pieces)).toEqual([{ kind: "mention", value: "@Ama", userId: AMA }]);
    expect(pieces.map((piece) => piece.value).join("")).toBe("are you coming @Ama?");
  });

  it("keeps the message readable as one sentence", () => {
    /* No chips, no cards: the reconstructed text is character-for-character
     * what was sent. */
    const text = "hi @Ama and @Kojo, see you at 6";
    const pieces = render(text, [
      { userId: AMA, displayName: "Ama", username: "ama_s" },
      { userId: AMA_TWO, displayName: "Kojo", username: "kojo" }
    ]);
    expect(pieces.map((piece) => piece.value).join("")).toBe(text);
    expect(mentionsOf(pieces)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// M3 — identity, not text
// ---------------------------------------------------------------------------

describe("M3 — colliding display names resolve to the chosen person", () => {
  it("matches the longest name first so '@Ama Serwaa' is not claimed by '@Ama'", () => {
    const pieces = render("tell @Ama Serwaa please", [
      { userId: AMA_TWO, displayName: "Ama", username: "ama" },
      { userId: AMA, displayName: "Ama Serwaa", username: "ama_s" }
    ]);
    expect(mentionsOf(pieces)).toEqual([
      { kind: "mention", value: "@Ama Serwaa", userId: AMA }
    ]);
  });

  it("carries the user id, never the visible name, as the identity", () => {
    /* A rename must not redirect an old mention: the id is the authority and
     * the text is only a rendering of it. */
    const pieces = render("@Ama hello", [
      { userId: AMA, displayName: "Ama", username: "ama_s" }
    ]);
    expect(mentionsOf(pieces)[0]).toMatchObject({ userId: AMA });
  });
});

// ---------------------------------------------------------------------------
// M4 — prose cannot manufacture identity
// ---------------------------------------------------------------------------

describe("M4 — arbitrary @text is never linked", () => {
  it("renders @notARealPerson as ordinary text", () => {
    const pieces = render("@notARealPerson said so", []);
    expect(mentionsOf(pieces)).toHaveLength(0);
    expect(linksOf(pieces)).toHaveLength(0);
  });

  it("does not highlight a name the server did not store for this message", () => {
    /* Ama is a real person elsewhere; she was not mentioned HERE. */
    const pieces = render("ask @Ama about it", []);
    expect(mentionsOf(pieces)).toHaveLength(0);
  });

  it("leaves an email address alone", () => {
    const pieces = render("mail me at ama@example.com", [
      { userId: AMA, displayName: "Ama", username: "ama_s" }
    ]);
    expect(mentionsOf(pieces)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// M5/M6 — links keep working, and coexist with mentions
// ---------------------------------------------------------------------------

describe("M5 — URLs still linkify", () => {
  it("links an external URL and marks it external", () => {
    const pieces = render("see https://example.com/x now", []);
    expect(linksOf(pieces)).toEqual([
      { kind: "link", value: "https://example.com/x", href: "https://example.com/x", internal: false }
    ]);
  });

  it("routes an internal host through an in-app path", () => {
    const pieces = render("open https://mad-buddy.com/plans", []);
    expect(linksOf(pieces)[0]).toMatchObject({ internal: true, href: "/plans" });
  });
});

describe("M6 — a mention and a URL in one message", () => {
  it("renders both, each as itself", () => {
    const pieces = render("@Ama look at https://example.com/x", [
      { userId: AMA, displayName: "Ama", username: "ama_s" }
    ]);
    expect(mentionsOf(pieces)).toHaveLength(1);
    expect(linksOf(pieces)).toHaveLength(1);
    expect(linksOf(pieces)[0].value).toBe("https://example.com/x");
  });

  it("never reads a name out of the inside of a URL", () => {
    /* THE ORDERING ARGUMENT. Mentions are cut first and a mention run is never
     * re-scanned, so a URL that happens to contain "@" or a member's name
     * cannot become a profile link. */
    const pieces = render("https://example.com/@Ama/photos", [
      { userId: AMA, displayName: "Ama", username: "ama_s" }
    ]);
    const links = linksOf(pieces);
    expect(links).toHaveLength(1);
    expect(links[0].value).toBe("https://example.com/@Ama/photos");
    expect(links[0].internal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M7 — a deleted message names nobody
// ---------------------------------------------------------------------------

describe("M7 — deleted messages retain no interactive mention", () => {
  it("renders the tombstone placeholder with nothing tappable", () => {
    /* The projection already serves `mentions: []` for a tombstoned row, and
     * the placeholder text contains no "@" -- so this holds twice over. */
    const pieces = render("This message was deleted.", []);
    expect(mentionsOf(pieces)).toHaveLength(0);
    expect(linksOf(pieces)).toHaveLength(0);
  });

  it("the projection is what strips them, not the renderer", () => {
    const projection = stripComments(read("lib/messaging/mobile.ts"));
    expect(projection).toContain("mentions: row.deleted_at ? [] :");
  });
});

// ---------------------------------------------------------------------------
// The renderer itself
// ---------------------------------------------------------------------------

describe("the renderer actually consumes its mentions prop", () => {
  it("no longer discards it", () => {
    /* THE DEFECT, pinned: the signature took only `text`. */
    expect(renderer).not.toMatch(/export function SafeMessageText\(\{\s*text\s*\}/);
    expect(renderer).toMatch(/export function SafeMessageText\(\{\s*text,\s*mentions\s*\}/);
  });

  it("uses the canonical structured splitter, not a regex over the text", () => {
    expect(renderer).toContain("splitTextWithMentions");
    expect(renderer).not.toMatch(/\/@\[?\\?w/);
  });

  it("reserves URL spans BEFORE looking for mentions", () => {
    /* The ordering, pinned. Inverting these two lines re-breaks
     * `https://example.com/@Ama/photos` by cutting a name out of the middle of
     * somebody's link -- which is exactly what the first draft of this fix did
     * until the behavioural test above caught it. */
    expect(renderer.indexOf("tokenizeMessageText(text)")).toBeGreaterThan(-1);
    expect(renderer.indexOf("tokenizeMessageText(text)")).toBeLessThan(
      renderer.indexOf("splitTextWithMentions(token.value")
    );
  });

  it("M2 — links a mention to the canonical profile route", () => {
    expect(renderer).toContain("/friends/${encodeURIComponent(username)}");
  });

  it("never routes to a raw user id", () => {
    /* An internal UUID must never reach the address bar. */
    expect(renderer).not.toContain("/friends/${run.mentionedUserId}");
    expect(renderer).not.toContain("/friends/${mention.userId}");
  });

  it("keeps mention styling when there is no username to navigate to", () => {
    expect(renderer).toContain("if (!username)");
    expect(renderer).toContain("font-semibold text-primary");
  });

  it("introduces no HTML injection", () => {
    expect(renderer).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps the existing safe-link behaviour for external URLs", () => {
    expect(renderer).toContain('rel="noopener noreferrer"');
    expect(renderer).toContain("tokenizeMessageText");
  });
});

// ---------------------------------------------------------------------------
// M10 — who may be mentioned at all
// ---------------------------------------------------------------------------

describe("M10 — candidates are decided by the server", () => {
  const projection = stripComments(read("lib/messaging/mobile.ts"));
  const candidates = projection.slice(projection.indexOf("export async function listMentionCandidates"));

  it("requires the caller to be able to view the conversation", () => {
    expect(candidates).toContain("resolveConversationAccess");
    expect(candidates).toContain("if (!access.canView) return []");
  });

  it("offers only currently joined members", () => {
    expect(candidates).toContain('.eq("status", "joined")');
  });

  it("excludes the sender, and offers nobody in a direct chat", () => {
    expect(candidates).toContain('.neq("user_id", userId)');
    expect(candidates).toContain('conversation.conversation_type === "direct"');
  });

  it("cannot be used to enumerate the user directory", () => {
    /* No name query reaches the server: filtering happens on the client over a
     * list the server already decided the caller may see. */
    expect(candidates).not.toContain("ilike");
  });
});
