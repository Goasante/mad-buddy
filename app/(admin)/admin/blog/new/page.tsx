import { requireBlogOwner } from "@/lib/blog/admin";
import { ArticleEditor } from "@/components/blog/article-editor";
export const dynamic = "force-dynamic";
export default async function NewArticlePage() { await requireBlogOwner(); return <ArticleEditor />; }
