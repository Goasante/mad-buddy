import { LockKeyhole, ArrowLeft } from "lucide-react";
import { Link } from "@/lib/platform";
import { OPTIONAL_FEATURES, type OptionalFeature } from "@/lib/features/availability";

/** Sample shapes only. Locked pages never query, serialize or mount real content. */
export function LockedFeaturePreview({ feature }: { feature: OptionalFeature }) {
  const product = OPTIONAL_FEATURES[feature];
  return <section className="relative isolate min-h-[72dvh] overflow-hidden rounded-3xl bg-background" aria-labelledby="locked-feature-title">
    <div aria-hidden="true" className="pointer-events-none select-none space-y-6 p-6 opacity-65" style={{ filter: "blur(18px)" }}>
      <div className="h-10 w-40 rounded-xl bg-foreground/15" />
      <div className="flex gap-3">{[0,1,2].map(i => <div key={i} className="h-10 w-24 rounded-full bg-accent/30" />)}</div>
      <div className={feature === "linkr" ? "mx-auto max-w-sm space-y-5" : "space-y-5"}>
        {[0,1,2].map(i => <div key={i} className="rounded-3xl border border-border bg-secondary/65 p-5">
          <div className="mb-5 h-36 rounded-2xl bg-gradient-to-br from-accent/35 via-secondary to-foreground/15" />
          <div className="mb-3 h-5 w-2/3 rounded bg-foreground/20" /><div className="h-4 w-4/5 rounded bg-foreground/10" />
        </div>)}
      </div>
    </div>
    <div className="absolute inset-0 flex items-center justify-center bg-background/35 px-6 backdrop-blur-sm">
      <div className="max-w-sm rounded-3xl border border-border/70 bg-background/90 p-7 text-center shadow-xl">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><LockKeyhole className="h-6 w-6" aria-hidden="true" /></span>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{product.title} · Coming soon</p>
        <h1 id="locked-feature-title" className="text-2xl font-semibold">{product.headline}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{product.description}</p>
        <Link href="/dashboard" className="focus-ring mt-6 inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-3 text-sm font-medium"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Home</Link>
      </div>
    </div>
  </section>;
}
