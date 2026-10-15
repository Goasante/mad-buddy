import Link from "next/link";
import { AdminLogin } from "@/components/admin";
import StudentPreviewUpload from "@/components/student-preview-upload";
import { isAdmin } from "@/lib/shop/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "Private owner previews", robots: { index: false, follow: false } };
export default async function Page() {
  if (!(await isAdmin())) return <AdminLogin />;
  return <main className="login" style={{ maxWidth: 760 }}>
    <Link href="/admin">← Publishing desk</Link>
    <p className="eyebrow" style={{ marginTop: 28 }}>GOA / PRIVATE OWNER PREVIEW</p>
    <h1>The Student Edge</h1>
    <p>Student Edition 1.0.0. This preview and every companion file require the existing owner login. It creates no commercial listing or public download.</p>
    <p><a className="button gold" href="/admin/previews/student-edge/OPEN_INTERACTIVE_READER.html">Open private reader</a></p>
    <p><a href="/admin/previews/student-edge/GOA_The_Student_Edge.pdf">Open private book PDF</a> · <a href="/admin/previews/student-edge/Templates/Study_Toolkit.xlsx">Download private spreadsheet toolkit</a></p>
    <p><Link href="/admin/previews/layout">Check 375 / 390 px layout</Link></p>
    <details><summary>Upload the approved package</summary><StudentPreviewUpload /></details>
    <p className="fine">Sessions expire after eight hours. On iPhone, open this HTTPS page in Safari and sign in through the publishing desk if prompted. The price is not set and the student book is not on sale.</p>
  </main>;
}
