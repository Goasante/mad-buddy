/**
 * Inviting someone to Mad Buddy.
 *
 * ONE implementation, so every "Invite someone" in the product does the same
 * thing and reports the same outcome. It was previously inlined in the Find
 * Your Muddies sheet, where a copy-to-clipboard fallback set an error-styled
 * message on success -- the kind of drift a shared helper prevents.
 *
 * NEVER ADDRESSED TO ANYONE. The share carries a link and nothing else: no
 * phone number, no contact name, no recipient. Choosing who to send it to is
 * the OS share sheet's job and the user's decision, which is also why nothing
 * here reads the address book.
 *
 * THREE HONEST OUTCOMES, because a caller must be able to tell them apart:
 * the native sheet opened, the link went to the clipboard instead, or neither
 * worked and the user needs to be told rather than shown a silent no-op.
 */

export type InviteShareOutcome = "shared" | "copied" | "unavailable";

/** What gets shared. A link, and a line saying what it is. */
export const INVITE_MESSAGE = "Join me on Mad Buddy";

/**
 * Opens the share sheet, or copies the link.
 *
 * MUST BE CALLED FROM A USER GESTURE -- both `navigator.share` and the async
 * clipboard require one, and both silently reject otherwise.
 *
 * A cancelled share sheet reports "shared": the person saw the sheet and chose
 * to close it, which is a completed interaction, not a failure to fall back
 * from. Reopening or copying behind their back would be the wrong response to
 * somebody deciding not to invite anyone.
 */
export async function shareInvite(
  url?: string,
  /* What the share sheet says. Defaults to the app invite, so every existing
   * caller is unchanged -- an Event share passes its own line rather than
   * telling somebody to "join Mad Buddy" when they are being sent an Event. */
  message: string = INVITE_MESSAGE
): Promise<InviteShareOutcome> {
  if (typeof window === "undefined") return "unavailable";

  const link = url ?? window.location.origin;
  const text = message;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Mad Buddy", text, url: link });
    } catch {
      // Cancelling rejects with AbortError, and so does a share the platform
      // refused. Neither is worth a message, and neither justifies a fallback.
    }
    return "shared";
  }

  try {
    await navigator.clipboard.writeText(`${text} — ${link}`);
    return "copied";
  } catch {
    // No share sheet and no clipboard permission. The caller says so plainly
    // rather than leaving a button that appears to do nothing.
    return "unavailable";
  }
}
