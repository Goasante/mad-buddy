import Link from "next/link";
import { AdminLogin } from "@/components/admin";
import StudentPreviewLayout from "@/components/student-preview-layout";
import { isAdmin } from "@/lib/shop/auth";
import { shopStore } from "@/lib/shop/store";
import { BUYER_ZIP_SHA256, PREVIEW_FILES, PREVIEW_PREFIX } from "@/lib/shop/student-preview-manifest";
export const dynamic = "force-dynamic";
export const metadata = { title: "Private narrow-layout check", robots: { index: false, follow: false } };
export default async function Page() {
  if (!(await isAdmin())) return <AdminLogin />;
  const store = shopStore();
  const ready = await store.get(PREVIEW_PREFIX + "ready", { type: "json" });
  if (ready?.packageSha256 !== BUYER_ZIP_SHA256) return <main><Link href="/admin/previews">Upload the approved preview first.</Link></main>;
  const entry = await store.getWithMetadata(PREVIEW_PREFIX + "OPEN_INTERACTIVE_READER.html", { type: "arrayBuffer" });
  if (!entry || entry.metadata.sha256 !== PREVIEW_FILES["OPEN_INTERACTIVE_READER.html"].sha256) return <main>Private reader unavailable.</main>;
  return <main style={{ padding: 24 }}><Link href="/admin/previews">← Private owner previews</Link><h1>Narrow-layout check</h1><StudentPreviewLayout html={new TextDecoder().decode(entry.data)} /></main>;
}
