/**
 * The platform adapter's call-shape contract, checked by the compiler.
 *
 * WHY THIS FILE EXISTS. mobile/tsconfig.json maps "@/lib/platform" to the
 * MOBILE barrel, so everything here is type-checked against the mobile
 * implementations -- the ones Vite actually bundles. Each element below is a
 * call shape a real shared component uses today. If an adapter signature
 * drifts from what those components need, this file stops compiling and the
 * mobile CI job goes red, instead of the gap surfacing on a device during
 * migration.
 *
 * Three of these exist because a review caught the adapter getting them wrong:
 *   - the object href form (components/scan/scan-page.tsx)
 *   - the { scroll: false } options argument (components/moments)
 *   - fill with a caller-specified object-fit (badges, brand marks)
 *
 * It is never rendered or imported by the app; being in `include` is the whole
 * point. Add a shape here whenever a migration needs a new one.
 */
import { Link, Image, useRouter } from "@/lib/platform";

export function PlatformContract() {
  const router = useRouter();

  return (
    <div>
      {/* Object destinations: components/scan/scan-page.tsx. */}
      <Link href={{ pathname: "/events", query: { event: "e1", room: "r1" } }}>Room</Link>
      <Link href={{ pathname: "/events", query: { event: "e1" } }}>Event</Link>

      {/* String destinations with the props real call sites pass. */}
      <Link href="/friends" className="x" aria-label="Muddies" prefetch={false}>
        Muddies
      </Link>
      <Link href="https://example.com">External</Link>

      {/* Navigation options: components/moments uses { scroll: false }. */}
      <button onClick={() => router.replace("/moments?tab=live", { scroll: false })}>replace</button>
      <button onClick={() => router.push("/plans", { scroll: false })}>push with options</button>
      <button onClick={() => router.push("/plans")}>push</button>
      <button onClick={() => router.back()}>back</button>

      {/* fill plus a caller-specified object-fit, which must not be overridden. */}
      <Image src="/x.png" alt="" fill className="object-contain" />
      <Image src="/x.png" alt="" width={10} height={10} />
    </div>
  );
}
