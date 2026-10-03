"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { saveArticleAction } from "@/app/(admin)/admin/blog/actions";
import { ArticleContent } from "./article-content";
import { BLOG_FEATURES, type Article } from "@/lib/blog/model";
import { ImageControls } from "./image-controls";
import { imageMarker, type ArticleImage } from "@/lib/blog/image-model";

type Revision = { version: number; savedAt: string; article: Article };
const empty: Article = { title: "", slug: "", description: "", category: "Friendship", audience: "", searchIntent: "", feature: "linkr", body: "" };
export function ArticleEditor({ initial = empty, id = null, version = 0, live = false, revisions = [] }: { initial?: Article; id?: string | null; version?: number; live?: boolean; revisions?: Revision[] }) {
  const router = useRouter();
  const [article, setArticle] = useState(initial);
  const [currentVersion, setCurrentVersion] = useState(version);
  const [isLive, setLive] = useState(live);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("Save your draft before leaving this page.");
  const [dirty, setDirty] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const working = busy || imageBusy;
  useEffect(() => {
    if (!dirty && !imageBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, imageBusy]);
  function change<K extends keyof Article>(key: K, value: Article[K]) { setArticle((old) => ({ ...old, [key]: value })); setDirty(true); }
  function insertImage(image: ArticleImage) {
    const position = bodyInput.current?.selectionEnd ?? article.body.length;
    setArticle((old) => ({ ...old, images: (old.images ?? []).some((item) => item.id === image.id) ? old.images : [...(old.images ?? []), image], body: `${old.body.slice(0, position)}\n\n${imageMarker(image.id)}\n\n${old.body.slice(position)}` }));
    setDirty(true);
  }
  function editImage(image: ArticleImage, cover: boolean) {
    if (cover) change("cover", image);
    else change("images", (article.images ?? []).map((item) => item.id === image.id ? image : item));
  }
  function removeImage(id: string) {
    setArticle((old) => ({ ...old, images: (old.images ?? []).filter((image) => image.id !== id), body: old.body.split(imageMarker(id)).join("") }));
    setDirty(true);
  }
  async function save(intent: "save" | "publish" | "unpublish") {
    setBusy(true);
    try {
      const result = await saveArticleAction({ id, version: currentVersion, article, intent });
      setMessage(result.message);
      if (result.ok && result.id && result.version) {
        setCurrentVersion(result.version); setLive(Boolean(result.live)); setDirty(false);
        if (!id) router.replace(`/admin/blog/${result.id}` as Route);
        else router.refresh();
      }
    } catch { setMessage("The connection was interrupted. Copy your text and reload to check whether it saved before retrying."); }
    finally { setBusy(false); }
  }
  const inputClass = "focus-ring mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white disabled:opacity-60";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/admin/blog" aria-disabled={working} onClick={(event) => { if (working || (dirty && !window.confirm("Leave without saving your draft?"))) event.preventDefault(); }} className="focus-ring mr-auto text-sm underline">← Articles</Link>
      <span className="text-xs text-white/60">{isLive ? "Live article + working draft" : "Private draft"}{dirty ? " · Unsaved changes" : ""}</span>
      <button type="button" disabled={working} onClick={() => setPreview(!preview)} className="focus-ring rounded-full border border-white/20 px-5 py-2.5 text-sm disabled:opacity-50">{preview ? "Back to editor" : "Preview"}</button>
      <button type="button" disabled={working} onClick={() => save("save")} className="focus-ring rounded-full border border-white/20 px-5 py-2.5 text-sm disabled:opacity-50">{working ? "Working…" : "Save draft"}</button>
      <button type="button" disabled={working || !id} onClick={() => { if (window.confirm("Publish this draft to the public journal?")) void save("publish"); }} className="focus-ring rounded-full bg-[#E88C2B] px-5 py-2.5 text-sm font-semibold text-[#2A120A] disabled:opacity-50">{isLive ? "Publish update" : "Publish"}</button>
    </div>
    <p role="status" aria-live="polite" className="rounded-xl border border-white/10 p-4 text-sm text-white/80">{message}</p>
    {preview ? <div className="rounded-2xl bg-[#FEFBF3] text-[#311712]"><p className="px-6 pt-6 text-xs font-bold uppercase tracking-widest">Private preview · Not indexed</p><ArticleContent article={article} /></div> : <fieldset disabled={working} className="grid gap-7 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <label className="block text-sm font-medium">Article title<input value={article.title} maxLength={110} onChange={(e) => change("title", e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Shareable URL slug<input value={article.slug} disabled={!!id} maxLength={100} onChange={(e) => change("slug", e.target.value.toLowerCase())} placeholder="how-to-make-new-friends-in-accra" className={inputClass} /><span className="mt-2 block text-xs text-white/50">/blog/{article.slug || "your-article"} · Fixed after first save to protect shared links.</span></label>
        <label className="block text-sm font-medium">Search description<textarea value={article.description} maxLength={180} onChange={(e) => change("description", e.target.value)} rows={3} className={inputClass} /></label>
        <label className="block text-sm font-medium">Article body<textarea ref={bodyInput} value={article.body} maxLength={50000} onChange={(e) => change("body", e.target.value)} rows={24} className={`${inputClass} leading-7`} /></label>
        <ImageControls article={article} disabled={working} onCover={(image) => change("cover", image)} onInsert={insertImage} onEdit={editImage} onRemove={removeImage} onUploading={setImageBusy} />
        <p className="text-xs leading-6 text-white/60">Use a blank line between paragraphs. Start a section with “## Heading”. Start each bullet with “- ”. Text is rendered safely; HTML and embedded scripts are not supported.</p>
      </div>
      <aside className="space-y-5">
        <label className="block text-sm font-medium">Category<select value={article.category} onChange={(e) => change("category", e.target.value as Article["category"])} className={inputClass}>{["Friendship", "Privacy", "Making plans", "Behind Mad Buddy"].map((item) => <option key={item} className="bg-[#151515]">{item}</option>)}</select></label>
        <label className="block text-sm font-medium">Who is this for?<textarea value={article.audience} maxLength={180} onChange={(e) => change("audience", e.target.value)} rows={3} className={inputClass} /></label>
        <label className="block text-sm font-medium">What are they searching for?<textarea value={article.searchIntent} maxLength={180} onChange={(e) => change("searchIntent", e.target.value)} rows={3} className={inputClass} /></label>
        <label className="block text-sm font-medium">Relevant app feature<select value={article.feature} onChange={(e) => change("feature", e.target.value as Article["feature"])} className={inputClass}>{Object.entries(BLOG_FEATURES).map(([key, value]) => <option key={key} value={key} className="bg-[#151515]">{value.name}</option>)}</select></label>
        <div className="rounded-xl border border-white/10 p-4 text-xs leading-6 text-white/60">Audience and search intent are editorial notes, not public copy. Only the published snapshot enters search results or the sitemap.</div>
        {revisions.length > 0 && <label className="block text-sm font-medium">Saved versions<select value="" onChange={(e) => { const old = revisions.find((r) => r.version === Number(e.target.value)); if (old && window.confirm("Load this saved version into your editor? Unsaved text will be replaced; live content stays unchanged.")) { setArticle({ ...old.article, slug: initial.slug }); setDirty(true); setMessage("Saved version loaded. Save or publish when ready."); } }} className={inputClass}><option value="" className="bg-[#151515]">Load a previous version…</option>{revisions.map((r) => <option key={r.version} value={r.version} className="bg-[#151515]">v{r.version} · {new Date(r.savedAt).toLocaleString()}</option>)}</select></label>}
        {isLive && <><Link href={`/blog/${initial.slug}` as Route} target="_blank" className="focus-ring block text-sm underline">View live article ↗</Link><button type="button" disabled={working} onClick={() => { if (window.confirm("Remove this article from the public journal? All text and saved versions will remain available here.")) void save("unpublish"); }} className="focus-ring rounded-full border border-white/20 px-4 py-2 text-xs disabled:opacity-50">Unpublish (keep content)</button></>}
      </aside>
    </fieldset>}
  </div>;
}
