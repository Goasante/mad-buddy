import { DataStoragePage, type StorageUsage } from "@/components/settings/data-storage-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsDataStoragePage() {
  const usage: StorageUsage = { totalBytes: 0, assetCount: 0, imageBytes: 0, videoBytes: 0, audioBytes: 0, otherBytes: 0 };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const env = getSupabaseServerEnv();
  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const { data: assets } = await admin
      .from("media_assets")
      .select("id, content_type, size_bytes")
      .eq("owner_id", user.id)
      .is("deleted_at", null);
    const ids = (assets ?? []).map((asset) => asset.id);
    const { data: variants } = ids.length
      ? await admin.from("media_variants").select("media_asset_id, size_bytes").in("media_asset_id", ids)
      : { data: [] };
    const variantsByAsset = new Map<string, number>();
    for (const variant of variants ?? []) variantsByAsset.set(variant.media_asset_id, (variantsByAsset.get(variant.media_asset_id) ?? 0) + (variant.size_bytes ?? 0));
    for (const asset of assets ?? []) {
      const bytes = asset.size_bytes + (variantsByAsset.get(asset.id) ?? 0);
      usage.totalBytes += bytes;
      usage.assetCount += 1;
      if (asset.content_type.startsWith("image/")) usage.imageBytes += bytes;
      else if (asset.content_type.startsWith("video/")) usage.videoBytes += bytes;
      else if (asset.content_type.startsWith("audio/")) usage.audioBytes += bytes;
      else usage.otherBytes += bytes;
    }
  }
  return <DataStoragePage usage={usage} />;
}
