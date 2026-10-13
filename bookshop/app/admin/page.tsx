import Admin, { AdminLogin } from "@/components/admin";
import { isAdmin } from "@/lib/shop/auth";
import { configuration } from "@/lib/shop/store";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Publishing desk",
  robots: { index: false, follow: false },
};
export default async function Page() {
  if (!(await isAdmin())) return <AdminLogin />;
  const { config, etag } = await configuration();
  return <Admin initial={config} initialEtag={etag} />;
}
