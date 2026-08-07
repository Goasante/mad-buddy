/**
 * Attachment labels, shared by server and client.
 *
 * Split out of `lib/messaging/attachments.ts` because that module is
 * `server-only` (it signs URLs with the service role), while the thread and
 * the viewer need the same wording in the browser. One definition, so the
 * accessible name in a thread and in the full-screen viewer cannot drift.
 */

/**
 * A safe, contextual alt text for an image attachment.
 *
 * NEVER the filename. An uploader's filename routinely carries a person's
 * name, a place, or a camera's own labelling, none of which the recipient is
 * entitled to and none of which the sender meant to publish. Who sent it, and
 * the fact that it is a photo, is the whole of what a screen reader needs.
 */
export function attachmentAltText(senderName: string, isMine: boolean): string {
  return isMine ? "Photo you sent" : `Photo from ${senderName}`;
}
