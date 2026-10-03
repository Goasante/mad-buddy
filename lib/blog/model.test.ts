import { describe, it, expect } from "vitest";
import { articleSchema, articleBlocks, publishIssues, jsonLdString, readingMinutes } from "./model";
import { requiredLoginRedirect } from "@/lib/security/route-protection";
import { imageMarker } from "./image-model";
const article = { slug: "friends-in-accra", title: "Making friends in Accra", description: "A practical guide to making new friends in Accra at your own pace.", category: "Friendship", audience: "Adults new to Accra", searchIntent: "How to make friends in Accra", feature: "linkr", body: "A useful paragraph. ".repeat(30) };
describe("journal boundaries", () => {
  it("allows public articles but keeps authoring behind admin login", () => {
    expect(requiredLoginRedirect("/blog")).toBeNull();
    expect(requiredLoginRedirect("/blog/friends-in-accra")).toBeNull();
    expect(requiredLoginRedirect("/blogs-private")).toBe("/login");
    expect(requiredLoginRedirect("/admin/blog/new")).toBe("/admin/login");
  });
  it("requires a safe shareable URL and a real feature", () => {
    expect(articleSchema.safeParse(article).success).toBe(true);
    for (const slug of ["../admin", "A Title", "hello?draft=1", "javascript:alert(1)"]) expect(articleSchema.safeParse({ ...article, slug }).success).toBe(false);
    expect(articleSchema.safeParse({ ...article, feature: "made-up" }).success).toBe(false);
  });
  it("permits short drafts but blocks unfinished publishing", () => {
    const parsed = articleSchema.parse(article);
    expect(publishIssues(parsed)).toEqual([]);
    expect(publishIssues({ ...parsed, body: "TODO", audience: "", description: "Short" })).toHaveLength(3);
  });
  it("never treats raw HTML as executable content", () => {
    expect(articleBlocks("<script>alert(1)</script>")[0]).toMatchObject({ kind: "paragraph", text: "<script>alert(1)</script>" });
    expect(jsonLdString({ title: "</script><script>bad</script>" })).not.toContain("<");
  });
  it("renders only the documented basic article structure", () => {
    expect(articleBlocks("## Start here\n\nA paragraph.\n\n- One\n- Two").map((b) => b.kind)).toEqual(["heading", "paragraph", "list"]);
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(401))).toBe(3);
  });
  it("requires descriptions and refuses broken inserted-image references", () => {
    const image = { id: "4d8d6b75-7b43-4cb7-9c53-8a1bc5871ed3", width: 1200, height: 800, bytes: 180000, alt: "", caption: "" };
    const parsed = articleSchema.parse({ ...article, cover: image, images: [image], body: `${article.body}\n\n${imageMarker(image.id)}` });
    expect(publishIssues(parsed)).toHaveLength(2);
    expect(articleBlocks(parsed.body).at(-1)).toMatchObject({ kind: "image", imageId: image.id });
    expect(publishIssues({ ...parsed, cover: null, images: [] })).toHaveLength(1);
    expect(articleSchema.safeParse({ ...article, cover: { ...image, bytes: 300000 } }).success).toBe(false);
    expect(articleSchema.safeParse({ ...article, images: Array(9).fill(image) }).success).toBe(false);
  });
});
