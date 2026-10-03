import { z } from "zod";

export const JOURNAL_IMAGE_MAX_BYTES = 200 * 1024;
export const JOURNAL_IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const JOURNAL_INLINE_IMAGE_LIMIT = 8;
export const articleImageSchema = z.object({
  id: z.string().uuid(),
  width: z.number().int().positive().max(1600),
  height: z.number().int().positive().max(1200),
  bytes: z.number().int().positive().max(JOURNAL_IMAGE_MAX_BYTES),
  alt: z.string().trim().max(240),
  caption: z.string().trim().max(300).default("")
});
export type ArticleImage = z.infer<typeof articleImageSchema>;
export function articleImageUrl(id: string) { return `/blog/media/${id}`; }
export function imageMarker(id: string) { return `[[image:${id}]]`; }
export function imageIdFromBlock(block: string) {
  const match = /^\[\[image:([0-9a-f-]{36})\]\]$/i.exec(block.trim());
  return match && z.string().uuid().safeParse(match[1]).success ? match[1] : null;
}
