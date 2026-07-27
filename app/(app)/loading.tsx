export default function AppLoading() {
  return (
    <div
      className="mx-auto w-full max-w-[1200px] animate-pulse px-4 py-6 sm:px-6 lg:px-8"
      role="status"
      aria-label="Loading page"
    >
      <span className="sr-only">Loading page</span>
      <div className="h-8 w-40 rounded-lg bg-secondary" />
      <div className="mt-3 h-4 w-64 max-w-full rounded bg-secondary/70" />
      <div className="mt-8 h-28 rounded-2xl border border-border/60 bg-card/60" />
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <div className="h-44 rounded-2xl border border-border/60 bg-card/60" />
        <div className="h-44 rounded-2xl border border-border/60 bg-card/60" />
      </div>
    </div>
  );
}
