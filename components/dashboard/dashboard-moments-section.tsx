import { HomeMomentsCarousel, type HomeMomentCreator } from "@/components/dashboard/home-moments-carousel";
import { buildMomentFeed, buildSpotlightFeed } from "@/lib/content/service";
import { isOpenMomentsEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Streams below the dashboard's primary content. The existing feed builders
 * remain the privacy authority for blocks, audience, expiry and Air access;
 * the client receives only one compact creator summary per visible author.
 */
export async function DashboardMomentsSection({ userId }: { userId: string }) {
  const admin = createSupabaseAdminClient();
  const [privateMoments, openEnabled] = await Promise.all([
    buildMomentFeed(admin, userId),
    isOpenMomentsEnabled(admin)
  ]);
  const openMoments = openEnabled ? await buildSpotlightFeed(admin, userId) : [];

  const creators = new Map<string, HomeMomentCreator>();
  for (const moment of privateMoments) {
    if (moment.authorId === userId || creators.has(moment.authorId)) continue;
    creators.set(moment.authorId, {
      authorId: moment.authorId,
      name: moment.authorName,
      avatarUrl: moment.authorAvatarUrl,
      previewUrl: moment.contentType === "photo" ? moment.mediaUrl : null,
      onAir: false,
      subtitle: formatMomentAge(moment.createdAt)
    });
  }
  // Air takes precedence for the badge/link when a creator appears in both
  // feeds. The feed builder has already enforced the public feature rules.
  for (const moment of openMoments) {
    if (moment.authorId === userId || creators.get(moment.authorId)?.onAir) continue;
    creators.set(moment.authorId, {
      authorId: moment.authorId,
      name: moment.authorName,
      avatarUrl: moment.authorAvatarUrl,
      previewUrl: moment.contentType === "photo" ? moment.mediaUrl : null,
      onAir: true,
      subtitle: "ON AIR"
    });
  }

  return <HomeMomentsCarousel creators={[...creators.values()]} />;
}

function formatMomentAge(createdAt: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.floor(elapsedMinutes / 60)}h ago`;
}

export function DashboardMomentsSkeleton() {
  return (
    <section aria-label="Loading Moments" aria-busy="true">
      <div className="mb-3 h-6 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      <div className="flex gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex w-[76px] flex-col items-center gap-2">
            <span className="h-16 w-16 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
            <span className="h-3 w-14 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </section>
  );
}
