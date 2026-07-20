import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

// Admin pages read live data with the service-role client and must never be
// statically prerendered at build time (build environments have no secrets;
// this exact prerender broke the first Vercel deploy of this branch).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await getSafetyAdminContext();

  if (!context.ok) {
    redirect("/admin/login");
  }

  const access = await getAdminAccess(createSupabaseAdminClient(), context);

  return (
    <AdminShell email={context.email} isDevelopmentFallback={context.isDevelopmentFallback} permissions={[...access.permissions]} role={access.role}>
      {children}
    </AdminShell>
  );
}
