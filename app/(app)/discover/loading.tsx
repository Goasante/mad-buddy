import { LinkrStateArtwork } from "@/components/socialize/linkr-state-artwork";

/** Linkr-specific route fallback; the shared app shell and bottom nav remain. */
export default function LinkrLoading() {
  return (
    <div
      className="linkr-route-loading mx-auto flex min-h-[calc(100svh-var(--mobile-nav-height)-env(safe-area-inset-bottom,0px))] w-full max-w-[900px] items-center justify-center px-2 py-8"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full flex-col items-center text-center">
        <LinkrStateArtwork
          variant="loading"
          priority
          className="w-full max-w-[26rem]"
        />
        <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          Refreshing your Linkr&hellip;
        </h1>
        <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          Checking your profile and who is available now.
        </p>
        <span className="linkr-loading-dots mt-5" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
