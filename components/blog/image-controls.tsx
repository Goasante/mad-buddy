"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { uploadArticleImageAction } from "@/app/(admin)/admin/blog/image-actions";
import { articleImageUrl, JOURNAL_INLINE_IMAGE_LIMIT, type ArticleImage } from "@/lib/blog/image-model";
import type { Article } from "@/lib/blog/model";

export function ImageControls({ article, disabled, onCover, onInsert, onEdit, onRemove, onUploading }: {
  article: Article; disabled: boolean;
  onCover: (image: ArticleImage | null) => void;
  onInsert: (image: ArticleImage) => void;
  onEdit: (image: ArticleImage, cover: boolean) => void;
  onRemove: (id: string) => void;
  onUploading: (uploading: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [purpose, setPurpose] = useState<"cover" | "inline">("cover");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const images = article.images ?? [];
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus("Choose an image smaller than 5 MB."); return; }
    setUploading(true); onUploading(true); setStatus("Resizing and compressing your image…");
    try {
      const form = new FormData(); form.set("image", file);
      const result = await uploadArticleImageAction(form);
      setStatus(result.message);
      if (result.ok && result.image) {
        if (purpose === "cover") onCover(result.image);
        else onInsert(result.image);
      }
    } catch { setStatus("The upload was interrupted. Try again; identical compressed files are reused."); }
    finally { setUploading(false); onUploading(false); if (input.current) input.current.value = ""; }
  }
  function choose(kind: "cover" | "inline") { setPurpose(kind); input.current?.click(); }
  const field = "focus-ring mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm";
  function details(image: ArticleImage, cover: boolean) {
    return <div key={`${cover ? "cover" : "inline"}-${image.id}`} className="rounded-xl border border-white/10 p-4">
      <Image src={articleImageUrl(image.id)} alt={image.alt || "Uploaded article image preview"} width={image.width} height={image.height} unoptimized className="mb-3 h-36 w-full rounded-lg object-contain" />
      <div className="flex items-center justify-between gap-3 text-xs text-white/60"><span>{cover ? "Cover image" : "Article image"} · {Math.ceil(image.bytes / 1024)} KB</span><button disabled={disabled} type="button" className="focus-ring underline" onClick={() => cover ? onCover(null) : onRemove(image.id)}>Remove</button></div>
      <label className="mt-3 block text-xs">Describe what the image shows (required)<input disabled={disabled} maxLength={240} value={image.alt} onChange={(e) => onEdit({ ...image, alt: e.target.value }, cover)} className={field} /></label>
      <label className="mt-3 block text-xs">Caption or photo credit (optional)<input disabled={disabled} maxLength={300} value={image.caption} onChange={(e) => onEdit({ ...image, caption: e.target.value }, cover)} className={field} /></label>
    </div>;
  }
  return <section aria-label="Article images" className="space-y-4 rounded-2xl border border-white/10 p-5">
    <div><h2 className="text-base font-semibold">Images</h2><p className="mt-2 text-xs leading-6 text-white/60">Upload JPEG, PNG, or WebP (up to 5 MB). We keep one compressed JPEG, at most 200 KB. The cover is also the social sharing image.</p></div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose article image" onChange={(e) => void upload(e.target.files?.[0])} />
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || uploading} onClick={() => choose("cover")} className="focus-ring rounded-full border border-white/20 px-4 py-2.5 text-sm disabled:opacity-50">{article.cover ? "Replace cover" : "Add cover image"}</button><button type="button" disabled={disabled || uploading || images.length >= JOURNAL_INLINE_IMAGE_LIMIT} onClick={() => choose("inline")} className="focus-ring rounded-full border border-white/20 px-4 py-2.5 text-sm disabled:opacity-50">Insert image</button></div>
    <p className="text-xs leading-6 text-white/60">Place the text cursor where you want an image, then choose Insert image. Up to {JOURNAL_INLINE_IMAGE_LIMIT} images within an article. Uploaded images stay private until published.</p>
    {status && <p role="status" aria-live="polite" className="text-sm text-[#E88C2B]">{status}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{article.cover && details(article.cover, true)}{images.map((image) => details(image, false))}</div>
  </section>;
}
