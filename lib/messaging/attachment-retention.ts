export type AttachmentMessageState = {
  status: string;
  deletedAt: string | null;
};

/** Deleted and moderated messages retain history but never mint new media URLs. */
export function messageAttachmentCanBeSigned(message: AttachmentMessageState): boolean {
  if (message.deletedAt) return false;
  return message.status === "sent" || message.status === "delivered" || message.status === "read";
}

/**
 * Current retention policy:
 * - delete-for-everyone and moderation stop signing immediately;
 * - their attachment remains retained with the historical message;
 * - account deletion removes owned storage immediately;
 * - hard parent deletion makes the asset unattached and the orphan job queues it.
 */
export const MESSAGE_ATTACHMENT_RETENTION = "retain_with_parent" as const;
