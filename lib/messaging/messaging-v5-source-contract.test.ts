import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Messaging V5 product source contracts", () => {
  it("removes contact sharing as a new write capability but keeps the historical reader", () => {
    const share = source("components/messaging/structured-share-v4.tsx");
    const actions = source("app/(app)/messaging-structured-share-actions.ts");
    const reader = source("components/messaging/structured-message-card-v4.tsx");

    expect(share).not.toContain("Share Contact");
    expect(share).not.toContain('kind: "contact"');
    expect(actions).not.toContain("const contactSchema");
    expect(actions).toContain('message.message_type === "contact"');
    expect(reader).toContain('payload.kind === "contact"');
  });

  it("uses one composer + menu for media, Place and Plan/Event", () => {
    const picker = source("components/messaging/attachment-picker.tsx");
    const shell = source("components/messaging/message-composer-v4-shell.tsx");
    expect(picker).toContain('label: "Camera"');
    expect(picker).toContain('label: "Photos"');
    expect(picker).toContain('label: "Video"');
    expect(picker).toContain('label: "Document"');
    expect(picker).toContain('label: "Place"');
    expect(picker).toContain('label: "Plan / Event"');
    expect(shell).not.toContain("<StructuredShareV4");
  });

  it("keeps primary inbox filters calm while preserving Favorites and Archived", () => {
    const page = source("components/messages/messages-page-v4.tsx");
    expect(page).toContain("PRIMARY_FILTERS");
    expect(page).toContain("SECONDARY_FILTERS");
    expect(page).toContain("More chat filters");
    expect(page).not.toContain("Swipe chats → unread/favorite");
  });

  it("converges the canonical composer onto the V3 voice gesture model", () => {
    const canonical = source("components/messaging/message-composer.tsx");
    const rich = source("components/messaging/message-composer-v3.tsx");
    expect(canonical).toContain("MessageComposerV3");
    expect(rich).toContain("onPointerDown={startHold}");
    expect(rich).toContain("Release to send");
    expect(rich).toContain("Slide left to cancel or up to lock");
  });

  it("does not force light hex backgrounds in the V4 conversation theme", () => {
    const page = source("components/messages/messages-page-v4.tsx");
    expect(page).not.toContain('background: "#FFFDFC"');
    expect(page).not.toContain("#fffaf3");
    expect(page).not.toContain("#fff9f4");
    expect(page).not.toContain("#f8faf6");
  });

  it("paints the Messages canvas from classes, not from themeStyle", () => {
    /* themeStyle used to set backgroundColor: hsl(var(--background)) beneath
       every wallpaper. That token is warmer than the shell's own dark value, so
       in dark mode an open conversation was a brown slab inside a near-black
       frame. The wallpaper contributes its gradient and nothing else; the
       canvas is one class, so the inbox and a conversation match the shell. */
    const page = source("components/messages/messages-page-v4.tsx");
    expect(page).toContain("const base: CSSProperties = {};");
    expect(page).not.toContain('backgroundColor: "hsl(var(--background))"');
    expect(page).toContain("dark:bg-[#111112]");
  });
});
