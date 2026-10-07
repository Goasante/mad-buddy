import { z } from "zod";
import { articleImageSchema, imageIdFromBlock, JOURNAL_INLINE_IMAGE_LIMIT } from "./image-model";

export const BLOG_FEATURES = {
  linkr: { name: "Linkr", title: "Start with a conversation.", body: "Choose to discover new people with Linkr, then take the conversation at your own pace." },
  meetups: { name: "Meetups", title: "Turn a connection into time together.", body: "Invite Muddies or meet someone new nearby, then agree when and where to meet." },
  muddies: { name: "Muddies", title: "Stay close, without a location pin.", body: "Connect with trusted friends and use privacy-safe proximity on your terms." }
} as const;

export const BLOG_EDITOR_FEATURES = ["linkr", "meetups", "muddies"] as const;

export const articleSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100),
  title: z.string().trim().min(3).max(110),
  description: z.string().trim().max(180),
  category: z.enum(["Friendship", "Privacy", "Making plans", "Behind Mad Buddy"]),
  audience: z.string().trim().max(180),
  searchIntent: z.string().trim().max(180),
  feature: z.enum(["linkr", "meetups", "muddies"]),
  body: z.string().trim().max(50000),
  cover: articleImageSchema.nullable().optional(),
  images: z.array(articleImageSchema).max(JOURNAL_INLINE_IMAGE_LIMIT).optional()
});
export type Article = z.infer<typeof articleSchema>;
export type PublishedArticle = Article & { publishedAt: string; updatedAt: string };

export function publishIssues(article: Article): string[] {
  const issues: string[] = [];
  if (article.description.length < 40) issues.push("Add a useful search description (at least 40 characters).");
  if (article.body.length < 300) issues.push("Add the full article before publishing.");
  if (!article.audience || !article.searchIntent) issues.push("Specify the reader and the question this article answers.");
  const images = article.images ?? [];
  const ids = new Set(images.map((image) => image.id));
  if (article.cover && article.cover.alt.length < 3) issues.push("Describe the cover image for readers who cannot see it.");
  if (images.some((image) => image.alt.length < 3)) issues.push("Add a description for each article image.");
  for (const block of article.body.split(/\n\s*\n/)) {
    const id = imageIdFromBlock(block);
    if (id && !ids.has(id)) issues.push("An inserted image is missing. Remove its marker or upload it again.");
  }
  return issues;
}

export function readingMinutes(body: string) { return Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 200)); }

export function articleBlocks(body: string) {
  return body.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
    const imageId = imageIdFromBlock(block);
    if (imageId) return { kind: "image" as const, imageId, id: `section-${index}` };
    if (block.startsWith("## ")) return { kind: "heading" as const, text: block.slice(3).trim(), id: `section-${index}` };
    if (block.split("\n").every((line) => line.startsWith("- "))) return { kind: "list" as const, items: block.split("\n").map((line) => line.slice(2)), id: `section-${index}` };
    return { kind: "paragraph" as const, text: block, id: `section-${index}` };
  });
}

export function jsonLdString(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
