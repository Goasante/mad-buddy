import { notFound } from "next/navigation";
import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { PROXIMITY_GLOW_LEVELS } from "@/lib/proximity/glow-config";

/**
 * The real Home "Near" strip, reproduced with its PRODUCTION container classes.
 *
 * DEVELOPMENT ONLY (404s in production, same guard as the Glow harness).
 *
 * WHY THIS EXISTS. Home is auth-gated and driven by live proximity data, so it
 * cannot be screenshotted deterministically. But the thing that actually breaks
 * on a real product surface is not the Glow itself -- it is the CONTAINER: the
 * Near strip is `overflow-x: auto` with only `py-2` of vertical room, and a
 * scroll container clips on every side. That is a property of the classes, not
 * of the data, so copying the exact container markup from
 * components/dashboard/dashboard-page.tsx reproduces the real risk faithfully.
 *
 * The classes below are copied verbatim from NearbyHero. If they ever drift
 * from the real Home strip this page stops being evidence, so
 * lib/proximity/near-section.test.ts asserts they still match.
 */

export const dynamic = "force-static";

export default function NearSurfacePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Near strip — real container</h1>
        <p className="text-sm text-muted-foreground">
          The production Near strip classes with a Glow in every state. Watch the top and bottom
          edges: this container scrolls, so it clips on all four sides.
        </p>
      </header>

      {/* Verbatim from NearbyHero in dashboard-page.tsx. */}
      <div
        className="near-strip -mx-4 flex items-start gap-4 overflow-x-auto px-4 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
        aria-label="Nearby Muddies"
        data-near-strip
      >
        {PROXIMITY_GLOW_LEVELS.map((level, index) => (
          <button
            key={level}
            type="button"
            className="focus-ring safe-motion group flex w-[4.75rem] shrink-0 flex-col items-center gap-2.5 text-center"
          >
            <span className="relative grid h-[4.5rem] w-full place-items-center">
              <ProximityGlowAvatar
                name={`Muddy ${index + 1}`}
                level={level}
                size="md"
                decorative
                intensity={0.72}
              />
            </span>
            <span className="w-full truncate text-sm font-semibold leading-none">Muddy</span>
          </button>
        ))}
      </div>
    </main>
  );
}
