export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 pt-6" role="status" aria-live="polite" aria-label="Loading page">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-36 animate-pulse rounded-2xl border border-border/70 bg-card/50 motion-reduce:animate-none" />
        <div className="h-36 animate-pulse rounded-2xl border border-border/70 bg-card/50 motion-reduce:animate-none" />
      </div>
      <span className="sr-only">Loading Mad Buddy</span>
    </div>
  );
}
