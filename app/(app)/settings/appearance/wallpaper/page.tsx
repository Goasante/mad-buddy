import { WallpaperSettings } from "@/components/settings/wallpaper-settings";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { loadWallpaperPickerData } from "@/lib/wallpapers/service";
import { BUNDLED_WALLPAPERS, buildPickerCatalog, DEFAULT_WALLPAPER_SLUG } from "@/lib/wallpapers/catalog";

export const dynamic = "force-dynamic";

export default async function WallpaperSettingsPage() {
  const user = await getCurrentUser();
  const env = getSupabaseServerEnv();

  // Degrade gracefully (bundled free catalog, no persistence) if we can't reach
  // Supabase — the picker still renders rather than erroring.
  if (!user || !env.url || !env.serviceRoleKey) {
    return (
      <WallpaperSettings
        data={{
          picker: buildPickerCatalog(BUNDLED_WALLPAPERS, "free"),
          selectedSlug: DEFAULT_WALLPAPER_SLUG,
          custom: { hasActive: false, thumbUrl: null, canUse: false }
        }}
      />
    );
  }

  const admin = createSupabaseAdminClient();
  const data = await loadWallpaperPickerData(admin, user.id, "free");

  return <WallpaperSettings data={data} />;
}
