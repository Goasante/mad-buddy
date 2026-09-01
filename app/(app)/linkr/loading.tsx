import { LinkrStateArtwork } from "@/components/linkr/linkr-state-artwork";

export default function LinkrLoading() {
  return (
    <div className="linkr-safe-screen" data-linkr-safe-area>
      <section
        className="mx-auto flex min-h-[calc(100svh-var(--mobile-nav-height)-env(safe-area-inset-bottom,0px))] w-full max-w-[32rem] flex-col items-center justify-center px-5 py-8 text-center"
        role="status"
        aria-live="polite"
      >
        <LinkrStateArtwork
          variant="loading"
          priority
          className="w-full max-w-[22rem] sm:max-w-[25rem]"
        />
        <strong className="mt-1 text-balance text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          Refreshing your Linkr…
        </strong>
        <small className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          Checking your profile and who is available now.
        </small>
        <span className="mt-5 inline-flex items-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:120ms] motion-reduce:animate-none" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:240ms] motion-reduce:animate-none" />
        </span>
      </section>
    </div>
  );
}
