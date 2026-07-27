import { redirect } from "next/navigation";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-ui";
import { WallpaperAdmin } from "@/components/admin/wallpapers/wallpaper-admin";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { loadAdminWallpapers } from "@/lib/wallpapers/admin";

export const dynamic = "force-dynamic";

export default async function AdminWallpapersPage() {
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");

  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.wallpapers.manage")) redirect("/admin");

  const rows = await loadAdminWallpapers(admin);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Wallpapers"
        description="Manage the wallpaper catalog users can choose from. Set each wallpaper's access tier (Free / Buddy Plus / Buddy Pro), reorder them, and enable or retire them. Every change is rate-limited and written to the audit log; Mad Buddy Default always stays available as the safe fallback."
      />
      <AdminSection title="Catalog" description="Bundled and managed wallpapers. Disabled wallpapers disappear from the picker but keep users' preferences intact.">
        <WallpaperAdmin rows={rows} />
      </AdminSection>
    </div>
  );
}
