export type RichMediaMessageView = {
  messageId: string;
  mediaId: string;
  kind: "video" | "file";
  /** Inline/open URL. */
  url: string;
  /** File-only URL whose Storage response carries Content-Disposition with the original filename. */
  downloadUrl?: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
};
