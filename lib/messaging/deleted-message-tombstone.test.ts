import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMessageText } from "@/components/messages/safe-message-text";
import { DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";

/**
 * Deleted messages must READ as deleted.
 *
 * D1 made a tombstone a valid database row: deleting keeps the message id and
 * nulls text_content. The server projection matches that -- `deleted: true`,
 * `text: null`, no mentions, no attachment, no voice.
 *
 * D2 was the presentation half. The bubble rendered the placeholder as
 *
 *   {message.text ? <SafeMessageText text={message.deleted ? PLACEHOLDER : ...} /> : null}
 *
 * so for a canonical tombstone (text === null) the OUTER condition was false
 * and "This message was deleted." could never appear -- a deleted message
 * simply vanished. The deleted state must be tested BEFORE message.text.
 *
 * These tests render the real branch through react-dom/server with the real
 * SafeMessageText and the real placeholder constant. The repo has no DOM test
 * stack (vitest runs environment "node", including only lib), and none is
 * needed to prove which branch wins -- so this is written with createElement
 * rather than JSX and lives under lib/ where the suite runs. The source
 * assertions then pin the same ordering inside the actual component, because
 * that is where the defect lived.
 */

/** The bubble's text-body branch, transcribed from message-bubble-v4.tsx. */
function textBody(input: {
  deleted: boolean;
  text: string | null;
  mentions?: ReadonlyArray<{ userId: string; displayName: string; username: string | null }>;
}): ReactNode {
  return createElement(
    Fragment,
    null,
    input.deleted
      ? createElement(SafeMessageText, { text: DELETED_MESSAGE_PLACEHOLDER })
      : input.text
        ? createElement(SafeMessageText, { text: input.text, mentions: input.mentions })
        : null
  );
}

const render = (input: Parameters<typeof textBody>[0]) => renderToStaticMarkup(textBody(input));

const ROOT = process.cwd();
const bubble = readFileSync(path.join(ROOT, "components/messaging/message-bubble-v4.tsx"), "utf8");

/** Strip comments so prose describing a branch is never read as the branch. */
const code = bubble
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => (line.indexOf("//") === -1 ? line : line.slice(0, line.indexOf("//"))))
  .join("\n");

describe("a canonical tombstone renders the placeholder", () => {
  it("renders the placeholder for deleted=true with text=null", () => {
    // The exact shape the server projection produces for a deleted message.
    expect(render({ deleted: true, text: null })).toContain(DELETED_MESSAGE_PLACEHOLDER);
  });

  it("uses the product copy", () => {
    expect(DELETED_MESSAGE_PLACEHOLDER).toBe("This message was deleted.");
  });

  it("renders nothing else -- no stray text", () => {
    const text = render({ deleted: true, text: null }).replace(/<[^>]*>/g, "").trim();
    expect(text).toBe(DELETED_MESSAGE_PLACEHOLDER);
  });
});

describe("a live message is untouched", () => {
  it("renders its own text", () => {
    const html = render({ deleted: false, text: "hello" });
    expect(html).toContain("hello");
    expect(html).not.toContain(DELETED_MESSAGE_PLACEHOLDER);
  });

  it("renders nothing when a live message genuinely has no text", () => {
    // A media-only message: the body is drawn by the attachment branch.
    expect(render({ deleted: false, text: null })).toBe("");
  });
});

describe("deleted content never survives into the bubble", () => {
  it("does not render text a caller still holds on a deleted message", () => {
    // Defence in depth: the projection nulls text, but if any client-side path
    // (an optimistic row, a stale cache entry) still carries the original, the
    // deleted branch must win and the words must not reach the screen.
    const html = render({ deleted: true, text: "the secret original message" });
    expect(html).not.toContain("the secret original message");
    expect(html).toContain(DELETED_MESSAGE_PLACEHOLDER);
  });

  it("does not render mentions carried alongside a deleted message", () => {
    const html = render({
      deleted: true,
      text: "hi @ama",
      mentions: [{ userId: "u1", displayName: "Ama", username: "ama" }]
    });
    expect(html).not.toContain("Ama");
    expect(html).not.toContain("/friends/ama");
    expect(html).toContain(DELETED_MESSAGE_PLACEHOLDER);
  });
});

describe("the real component checks deleted before text", () => {
  it("no longer gates the placeholder behind message.text", () => {
    // The exact D2 defect: an outer `message.text ?` guard around the
    // placeholder, which a tombstone (text === null) can never satisfy.
    expect(code).not.toMatch(/\{message\.text\s*\?\s*<SafeMessageText\s+text=\{message\.deleted/);
  });

  it("renders the placeholder from the deleted flag alone", () => {
    expect(code).toMatch(/\{message\.deleted\s*\?\s*\(?\s*<SafeMessageText\s+text=\{DELETED_MESSAGE_PLACEHOLDER\}/);
  });

  it("passes no mentions on the deleted branch", () => {
    const branch = /\{message\.deleted \?[\s\S]*?<SafeMessageText[^/]*\/>/.exec(code)?.[0] ?? "";
    expect(branch).not.toBe("");
    expect(branch).not.toMatch(/mentions=/);
  });

  it("never substitutes fabricated text for the deleted original", () => {
    // The fix must not restore or synthesize content: the placeholder is the
    // only string a tombstone may show.
    expect(code).not.toMatch(/\[deleted\]/i);
  });
});

describe("deleted media and structured payloads stay suppressed", () => {
  // These guards predate D2 and were already correct; pinning them means the
  // tombstone work can never regress them.
  it("suppresses the image attachment", () => {
    expect(code).toMatch(/!message\.deleted && message\.attachment/);
  });

  it("suppresses voice", () => {
    expect(code).toMatch(/!message\.deleted && message\.voice/);
  });

  it("suppresses video and file", () => {
    expect(code).toMatch(/!message\.deleted && \(message\.messageType === "video" \|\| message\.messageType === "file"\)/);
  });

  it("suppresses contact, place and event cards", () => {
    expect(code).toMatch(/!message\.deleted && \(message\.messageType === "contact" \|\| message\.messageType === "place" \|\| message\.messageType === "event"\)/);
  });

  it("suppresses the poll card", () => {
    expect(code).toMatch(/!message\.deleted && message\.messageType === "poll"/);
  });

  it("hides the edited marker on a tombstone", () => {
    expect(code).toMatch(/message\.editedAt && !message\.deleted/);
  });
});

describe("the server projection keeps its half of the contract", () => {
  const mobile = readFileSync(path.join(ROOT, "lib/messaging/mobile.ts"), "utf8");

  it("serves no mentions for a deleted message", () => {
    expect(mobile).toMatch(/mentions:\s*row\.deleted_at \?\s*\[\]/);
  });

  it("serves no attachment or voice for a deleted message", () => {
    expect(mobile).toMatch(/attachment:\s*row\.deleted_at \?\s*null/);
    expect(mobile).toMatch(/voice:\s*row\.deleted_at \?\s*null/);
  });
});
