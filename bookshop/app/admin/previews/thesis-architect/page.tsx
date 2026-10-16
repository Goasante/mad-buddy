import Link from "next/link";
import { AdminLogin } from "@/components/admin";
import ThesisPreviewUpload from "@/components/thesis-preview-upload";
import { isAdmin } from "@/lib/shop/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "The Thesis Architect · Private candidate", robots: { index: false, follow: false } };
export default async function Page() {
  if (!(await isAdmin())) return <AdminLogin />;
  return <main className="login" style={{ maxWidth: 760 }}>
    <Link href="/admin/previews">← Private owner previews</Link>
    <p className="eyebrow" style={{ marginTop: 28 }}>GOA / PRIVATE ACCEPTANCE CANDIDATE</p>
    <h1>The Thesis Architect</h1>
    <p>Production candidate v0.3. Every customer file requires the existing owner login. No public release, price decision or paid listing is authorised.</p>
    <p><a className="button gold" href="/admin/previews/thesis-architect/OPEN_THESIS_ARCHITECT.html">Open private workspace</a></p>
    <p><a href="/admin/previews/thesis-architect/The_Thesis_Architect_Guide.pdf">Open 20-page guide</a> · <a href="/admin/previews/thesis-architect/LICENSE.txt">Single-user licence</a></p>
    <p>Practice backups: <a href="/admin/previews/thesis-architect/Examples/UNDERGRAD_Practice_Project.json">Undergraduate</a> · <a href="/admin/previews/thesis-architect/Examples/MASTERS_Practice_Project.json">Masters</a> · <a href="/admin/previews/thesis-architect/Examples/PHD_Practice_Project.json">PhD</a> · <a href="/admin/previews/thesis-architect/Examples/ESSAY_Practice_Project.json">Essay</a></p>
    <details><summary>Upload the unchanged v0.3 customer files</summary><ThesisPreviewUpload /></details>
    <p className="fine">Open the HTTPS workspace in Safari, not iPhone Files preview. Sign in through the publishing desk when prompted; owner sessions last eight hours. Keep this origin and path stable during persistence tests. Device storage is optional and unencrypted; use permitted practice material only.</p>
    <p className="fine">Phone Safari, Android, other browser engines and actual Microsoft Word acceptance must be recorded separately. Candidate status remains until final owner review.</p>
  </main>;
}
