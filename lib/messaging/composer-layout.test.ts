import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * The redesigned chat composer (Slice 3).
 *
 * Source-text assertions: this is a client component and vitest runs
 * environment "node", so there is no DOM to mount it into. Every assertion
 * below was verified to fail when the behaviour it describes is removed.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const composer = stripComments(read("components/messaging/message-composer-v3.tsx"));
const css = read("app/globals.css");
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));
const dmPage = stripComments(read("components/messages/messages-page.tsx"));

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("single-row composer", () => {
  it("puts the tools inside the field, as messaging apps do", () => {
    expect(composer).toContain("composer-row");
    expect(composer).toContain("composer-bubble");
  });

  it("does not show the sender their own avatar", () => {
    // You know who you are; the row needs that width for the message.
    //
    // Scoped to the COMPOSER ROW. The rule is about the input row's width, not
    // a ban on the component: the mention picker shows member avatars, which
    // is how you tell two people with similar names apart. Asserting against
    // the whole file failed for that unrelated and correct usage.
    expect(composer).not.toContain("composer-avatar");
    const row = composer.slice(composer.indexOf('<form'), composer.indexOf("</form>"));
    expect(row).not.toContain("<UserAvatar");
  });

  it("keeps the row clear of the device's bottom inset", () => {
    expect(css).toContain("padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px))");
  });

  it("does not let a mobile minimum height push the Circle composer below navigation", () => {
    expect(groupPage).toContain('[aria-label="Mobile navigation"]');
    expect(groupPage).toContain("Math.max(96, Math.round(available))");
    expect(groupPage).toContain("h-[var(--chat-height,15rem)]");
    expect(groupPage).toContain("min-h-0");
    expect(groupPage).not.toContain("min-h-[320px]");
  });

  it("gives every tool a comfortable touch target", () => {
    const tool = css.slice(css.indexOf(".composer-tool {"), css.indexOf(".composer-tool:hover"));
    expect(tool).toContain("width: 2.75rem");
    expect(tool).toContain("height: 2.75rem");
  });
});

// ---------------------------------------------------------------------------
// Multi-line input
// ---------------------------------------------------------------------------

describe("the field is genuinely multi-line", () => {
  it("uses a textarea rather than a single-line input", () => {
    // The old composer was an <input>, so Shift+Enter could not physically
    // produce a new line however the handler was written.
    expect(composer).toContain("<textarea");
    expect(composer).toContain("composer-field");
  });

  it("sends on Enter and breaks the line on Shift+Enter", () => {
    // The whole handler, not its first 400 characters: the mention picker
    // claims Enter/Arrow/Escape first (so Enter chooses a person rather than
    // sending a half-typed "@am"), which pushed the send branch past that
    // arbitrary window. The send behaviour itself is unchanged.
    const start = composer.indexOf("function handleKeyDown");
    const handler = composer.slice(start, composer.indexOf("\n  }", composer.indexOf("sendText();", start)));
    expect(handler).toContain('event.key !== "Enter" || event.shiftKey');
    expect(handler).toContain("event.preventDefault()");
    expect(handler).toContain("sendText()");
  });

  it("does not send mid-IME composition", () => {
    // Enter commits a candidate word in Japanese/Chinese/Korean input;
    // sending there truncates the sentence being written.
    expect(composer).toContain("event.nativeEvent.isComposing");
  });

  it("grows with the message but stops before eating the viewport", () => {
    expect(composer).toContain("MAX_FIELD_PX");
    expect(composer).toContain("Math.min(field.scrollHeight, MAX_FIELD_PX)");
    expect(css).toContain("max-height: 148px");
  });
});

// ---------------------------------------------------------------------------
// The tool rail
// ---------------------------------------------------------------------------

describe("tool rail", () => {
  it("offers the microphone only when there is nothing to send", () => {
    // One control, one position: mic while the composer is empty, send the
    // moment there is text or a photo.
    expect(composer).toContain("{canSendText || !voiceSupported ? (");
    // V3 labels the mic with its full gesture contract rather than two words.
    expect(composer).toMatch(/aria-label="Tap to record[^"]*"/);
  });

  it("offers mentions only in group conversations", () => {
    // A DM has nobody to disambiguate, so the control is absent there
    // rather than present and inert.
    //
    // The condition gained a second clause when mentions became real: a Circle
    // with no other members has nobody to offer either, so the control needs
    // candidates as well as isGroup. Asserting the invariant rather than the
    // old exact spelling.
    expect(composer).toContain("isGroup && mentionCandidates.length > 0");
    const mentionBlock = composer.slice(composer.indexOf("isGroup && mentionCandidates.length > 0"));
    expect(mentionBlock).toContain('aria-label="Mention someone"');
  });

  it("is marked multi-party by conversation KIND, never hard-coded", () => {
    /* BETA-009. This used to assert `dmPage` never mentions `isGroup` -- true
       when /messages hosted only direct chats. It also hosts PLAN CHAT, which
       is multi-party: the page already derives `hasMultipleSpeakers` from
       `kind !== "direct"` for exactly that reason, and mentions belong there
       for the same reason.

       So the invariant is not "the inbox never sets isGroup". It is that
       neither surface hard-codes the answer: the group page knows it is a
       group, and the inbox asks the conversation. A literal `isGroup={true}`
       on the inbox would put a mention picker in a two-person chat. */
    expect(groupPage).toContain("isGroup");
    expect(dmPage).toContain("isGroup");
    expect(dmPage, "the inbox hard-codes isGroup instead of deriving it")
      .not.toContain("isGroup={true}");
    expect(dmPage).toContain('isGroup={selected.kind !== "direct"}');
  });

  it("only offers mention candidates the server chose", () => {
    /* The candidate list is fetched per conversation from a server action that
       returns joined members only. The inbox must not assemble one itself from
       whatever profiles it happens to be holding. */
    expect(dmPage).toContain("getMentionCandidatesAction");
    expect(dmPage).toContain("mentionCandidates={mentionCandidates}");
  });

  it("keeps the existing attachment picker rather than a new one", () => {
    expect(composer).toContain("<AttachmentPicker");
    expect(composer).toContain("onLifecycleChange={setUploadState}");
  });

  it("does not reintroduce the paused camera", () => {
    expect(composer).not.toContain("CameraComposer");
    expect(composer).not.toContain("madCam");
  });
});

// ---------------------------------------------------------------------------
// Send affordance
// ---------------------------------------------------------------------------

describe("send button", () => {
  it("is the primary action whenever there is something to send", () => {
    expect(composer).toContain('className="composer-action is-send"');
    expect(css).toContain(".composer-action.is-send");
  });

  it("uses a Mad Buddy brand token, not a pasted gradient", () => {
    const ready = css.slice(css.indexOf(".composer-action.is-send"), css.indexOf(".composer-action:active"));
    expect(ready).toContain("var(--color-brand-orange)");
    expect(ready).not.toContain("linear-gradient");
  });

  it("blocks send while an attachment is still uploading", () => {
    expect(composer).toContain("disabled={!canSendText || uploadBusy}");
    expect(composer).not.toContain("disabled={!canSendText || uploadBusy || isPending}");
  });
});

// ---------------------------------------------------------------------------
// Preserved behaviour
// ---------------------------------------------------------------------------

describe("existing messaging behaviour survives the redesign", () => {
  it("keeps the attachment preview and its removal path", () => {
    expect(composer).toContain("<AttachmentPreview");
    expect(composer).toContain("discardAttachment(attachment)");
  });

  it("carries no instructional hint text", () => {
    // Messaging apps do not caption their own send button.
    expect(composer).not.toContain("Enter to send");
    expect(css).not.toContain(".composer-hint");
  });

  it("respects reduced motion", () => {
    // Checks every reduced-motion block rather than the last one: the file
    // gains more of them over time, and anchoring on lastIndexOf made this
    // assertion depend on which block happened to be appended most recently.
    const reducedBlocks = css
      .split("@media (prefers-reduced-motion: reduce)")
      .slice(1)
      .join("\n");
    expect(reducedBlocks).toContain(".composer-action");
    expect(reducedBlocks).toContain("transition: none");
  });
});
