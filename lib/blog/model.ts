import { z } from "zod";

export const BLOG_FEATURES = {
  linkr: { name: "Linkr", title: "Start with a conversation.", body: "Choose to discover new people with Linkr, then take the conversation at your own pace." },
  upfor: { name: "UpFor", title: "Make room for a shared interest.", body: "Show what you are up for and give a conversation a practical starting point." },
  plans: { name: "Plans", title: "Give that catch-up a date.", body: "Turn a good intention into a plan your friends can respond to." },
  muddies: { name: "Muddies", title: "Stay close, without a location pin.", body: "Connect with trusted friends and use privacy-safe proximity on your terms." }
} as const;

export const articleSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100),
  title: z.string().trim().min(3).max(110),
  description: z.string().trim().max(180),
  category: z.enum(["Friendship", "Privacy", "Making plans", "Behind Mad Buddy"]),
  audience: z.string().trim().max(180),
  searchIntent: z.string().trim().max(180),
  feature: z.enum(["linkr", "upfor", "plans", "muddies"]),
  body: z.string().trim().max(50000)
});
export type Article = z.infer<typeof articleSchema>;
export type PublishedArticle = Article & { publishedAt: string; updatedAt: string };

export function publishIssues(article: Article): string[] {
  const issues: string[] = [];
  if (article.description.length < 40) issues.push("Add a useful search description (at least 40 characters).");
  if (article.body.length < 300) issues.push("Add the full article before publishing.");
  if (!article.audience || !article.searchIntent) issues.push("Specify the reader and the question this article answers.");
  return issues;
}

export function readingMinutes(body: string) { return Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 200)); }

export function articleBlocks(body: string) {
  return body.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
    if (block.startsWith("## ")) return { kind: "heading" as const, text: block.slice(3).trim(), id: `section-${index}` };
    if (block.split("\n").every((line) => line.startsWith("- "))) return { kind: "list" as const, items: block.split("\n").map((line) => line.slice(2)), id: `section-${index}` };
    return { kind: "paragraph" as const, text: block, id: `section-${index}` };
  });
}

export function jsonLdString(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
