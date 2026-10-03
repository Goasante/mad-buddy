import Link from "next/link";
import type { Route } from "next";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { requireBlogOwner } from "@/lib/blog/admin";
import { articleSchema } from "@/lib/blog/model";
export const dynamic = "force-dynamic";
export default async function AdminBlogPage() {
  const { admin } = await requireBlogOwner();
  const { data, error } = await admin.from("blog_posts").select("id, draft, published, version, updated_at").order("updated_at", { ascending: false }).limit(200);
  if (error) throw new Error("The article list could not load.");
  return <div className="space-y-7"><AdminPageHeader title="Journal" description="Targeted articles, private drafts, and a separate published version. Owner-only publishing." action={<Link href="/admin/blog/new" className="focus-ring rounded-full bg-[#E88C2B] px-5 py-3 text-sm font-semibold text-[#2A120A]">New article</Link>} />
    <div className="divide-y divide-white/10 rounded-2xl border border-white/10">{(data ?? []).map((row) => { const parsed = articleSchema.safeParse(row.draft); if (!parsed.success) return null; const article = parsed.data; return <Link key={row.id} href={`/admin/blog/${row.id}` as Route} className="focus-ring block p-6 hover:bg-white/5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{article.title}</h2><span className="text-xs text-[#E88C2B]">{row.published ? "Live + draft" : "Private draft"} · v{row.version}</span></div><p className="mt-2 text-sm text-white/60">{article.audience || "Add the target audience"}</p><p className="mt-1 text-xs text-white/40">Search intent: {article.searchIntent || "Not set"}</p></Link>; })}</div>
  </div>;
}
