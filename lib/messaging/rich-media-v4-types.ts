export type RichMediaMessageView = {
  messageId: string;
  mediaId: string;
  kind: "video" | "file";
  url: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
};
